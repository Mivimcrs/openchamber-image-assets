// 共享纯逻辑：按接口类型路由到「云端图片 API」或「本地 ComfyUI」。
//
// 云端：沿用 生成.js 的 requestImages（/images/generations 或 /images/edits）。
// 本地：ComfyUI.js，模板来自 工作流.js（t2i / i2i / video 三个槽位）。
//
// 单次纪律：不做自动重试。所有失败都抛给人能看懂的错误，由上层包成结构化报告。

import {
  requestImages, validateSize, endpointFor, MAX_REFERENCES, MAX_COUNT,
} from './生成.js'
import { loadTemplate } from './工作流.js'
import {
  comfyUploadImage, runComfyWorkflow, aspectForSize, randomSeed,
} from './ComfyUI.js'

/** 统一的结果形状：{endpoint, requestedSize, model, prompt, results:[{bytes}], warnings, usage, promptId?} */
export function emptyResult(patch = {}) {
  return {
    endpoint: '',
    requestedSize: '',
    model: '',
    prompt: '',
    results: [],
    warnings: [],
    usage: null,
    ...patch,
  }
}

function pickSlot(iface, images, explicit) {
  if (explicit === 't2i' || explicit === 'i2i' || explicit === 'video') return explicit
  if (iface?.kind === 'local') return images?.length ? 'i2i' : 't2i'
  return ''
}

/**
 * 按接口生成。
 * @param {object} opts
 * @param {object} opts.iface 接口（{id, kind, baseUrl, defaultModel, comfy})
 * @param {string} opts.apiKey 密钥（本地接口可为空）
 * @param {string} opts.extRoot 扩展根（决定自带模板路径）
 * @param {string} opts.prompt
 * @param {string} [opts.size]
 * @param {number} [opts.count]
 * @param {Array<{bytes: Buffer, name?: string, mime?: string, id?: string}>} [opts.images]
 * @param {boolean} [opts.transparent]
 * @param {string} [opts.model] 覆盖默认模型
 * @param {string} [opts.slot] 本地接口的槽位（t2i / i2i / video）
 */
export async function generateWithInterface(opts, onProgress) {
  const {
    iface, apiKey, extRoot, prompt, images = [], transparent = false,
  } = opts
  if (!iface || typeof iface !== 'object') throw new Error('接口未配置')
  const text = typeof prompt === 'string' ? prompt.trim() : ''
  if (!text) throw new Error('提示词不能为空')
  if (images.length > MAX_REFERENCES) throw new Error(`参考图最多 ${MAX_REFERENCES} 张（收到 ${images.length} 张）`)

  const size = validateSize(opts.size || '', '1024x1536')
  const count = Math.min(MAX_COUNT, Math.max(1, Math.round(Number(opts.count) || 1)))

  if (iface.kind === 'local') {
    return generateLocal({ ...opts, iface, prompt: text, size, count, images }, onProgress)
  }
  return generateCloud({ ...opts, iface, apiKey, prompt: text, size, count, images, transparent }, onProgress)
}

async function generateCloud(opts, onProgress) {
  const { iface, apiKey, prompt, size, count, images, transparent } = opts
  const model = typeof opts.model === 'string' && opts.model.trim()
    ? opts.model.trim()
    : (iface.defaultModel || '')
  if (!model) throw new Error(`接口「${iface.name || iface.id}」没有设置默认模型：请在面板里填写，或调用时用 model 指定`)
  const out = await requestImages({
    baseUrl: iface.baseUrl,
    apiKey,
    model,
    prompt,
    size,
    count,
    images,
    transparent,
    timeoutMs: iface.timeoutMs || opts.timeoutMs,
  }, onProgress)
  return emptyResult({
    endpoint: out.endpoint,
    requestedSize: out.requestedSize,
    model: out.model,
    prompt: out.prompt,
    results: out.results,
    warnings: out.warnings,
    usage: out.usage,
    count: out.count,
  })
}

async function generateLocal(opts, onProgress) {
  const { iface, extRoot, prompt, size, count, images } = opts
  const comfy = iface.comfy || {}
  const slot = pickSlot(iface, images, opts.slot)
  if (slot === 'video' && !comfy.workflows?.video) {
    throw new Error(
      '视频生成还没有可用工作流：本机未安装任何视频模型（8GB 显存），' +
      '请在面板「设置 → 接口 → 本地 ComfyUI」里填入视频工作流模板路径后再用',
    )
  }
  if (count > 1) {
    // ComfyUI 的 batch 需模板支持；当前模板固定 batch_size=1
    onProgress?.(`本地模板一次输出 1 张，忽略 count=${count}`)
  }

  const warnings = []
  const loaded = loadTemplate(extRoot, slot, comfy.workflows?.[slot])
  const baseUrl = iface.baseUrl
  let imageName = ''
  if (images.length) {
    onProgress?.('上传参考图到 ComfyUI…')
    const ref = images[0]
    const ext = ref.name && /\.(png|jpe?g|webp)$/i.test(ref.name) ? ref.name.split('.').pop().toLowerCase() : 'png'
    imageName = await comfyUploadImage(baseUrl, {
      bytes: ref.bytes,
      name: `ref-${Date.now().toString(36)}.${ext}`,
    })
    if (images.length > 1) warnings.push(`本地工作流只使用第 1 张参考图（收到 ${images.length} 张）`)
  }

  const { megapixels } = aspectForSize(size)
  const seed = randomSeed()
  const out = await runComfyWorkflow({
    baseUrl,
    template: loaded.template,
    patch: {
      prompt,
      negative: comfy.negative || '',
      size,
      megapixels,
      seed,
      steps: comfy.steps,
      cfg: comfy.cfg,
      sampler: comfy.sampler,
      scheduler: comfy.scheduler,
      clip: comfy.clip,
      vae: comfy.vae,
      lora: comfy.lora,
      imageName,
      prefix: `openchamber/${slot}`,
    },
    timeoutMs: comfy.timeoutMs || opts.timeoutMs,
    pollMs: comfy.pollMs,
    onProgress,
  })

  warnings.push(...(out.warnings || []))
  const unetId = Object.keys(loaded.template).find((id) => loaded.template[id]?.class_type === 'UNETLoader')
  const unetName = unetId ? loaded.template[unetId]?.inputs?.unet_name : ''
  const model = `ComfyUI · ${unetName || '本地工作流'}`
  return emptyResult({
    endpoint: `comfyui:${slot}`,
    requestedSize: size,
    model,
    prompt,
    results: out.images.map((bytes) => ({ bytes })),
    warnings,
    promptId: out.promptId,
    templatePath: loaded.path,
    slot,
  })
}

/** 面板/工具展示用的「这次会走哪个接口、哪个模板」。 */
export function describeRoute(iface, extRoot, images, slot) {
  if (!iface) return { kind: '', summary: '未配置接口' }
  if (iface.kind === 'cloud') {
    return {
      kind: 'cloud',
      interfaceId: iface.id,
      summary: `云端 ${iface.baseUrl} · ${iface.defaultModel || '未设默认模型'}`,
      endpointFor: endpointFor(images || []),
    }
  }
  const picked = pickSlot(iface, images, slot)
  const custom = iface.comfy?.workflows?.[picked] || ''
  return {
    kind: 'local',
    interfaceId: iface.id,
    slot: picked,
    template: custom || '(扩展自带模板)',
    summary: `本地 ComfyUI ${iface.baseUrl} · ${picked}`,
  }
}
