// 共享纯逻辑：本地 ComfyUI 客户端（HTTP API，无第三方依赖）。
//
// 对接的是 ComfyUI 的「API 格式」提示词（/prompt 直接吃 JSON 图），不是 UI 工作流。
// 模板由 工作流/ 下的 *.api.json 提供，运行时只做「打桩」（替换提示词、尺寸、种子、模型名、参考图）。
//
// 流程：健康检查 → 上传参考图（i2i）→ 打桩模板 → POST /prompt → 轮询 /history/{id} → GET /view 下载。
// 单次纪律：不自动重试；失败把原因抛出去，由上层变成结构化报告。

import crypto from 'node:crypto'

export const DEFAULT_COMFY_URL = 'http://127.0.0.1:8188'
export const COMFY_TIMEOUT_MS = 900_000
export const COMFY_POLL_MS = 1500

// ResolutionSelector 支持的画幅（ComfyUI 内置节点 nodes_resolution.py）
export const COMFY_ASPECTS = [
  { label: '1:1', value: '1:1 (Square)', w: 1, h: 1 },
  { label: '2:3', value: '2:3 (Portrait Photo)', w: 2, h: 3 },
  { label: '3:2', value: '3:2 (Photo)', w: 3, h: 2 },
  { label: '3:4', value: '3:4 (Portrait Standard)', w: 3, h: 4 },
  { label: '4:3', value: '4:3 (Standard)', w: 4, h: 3 },
  { label: '9:16', value: '9:16 (Portrait Widescreen)', w: 9, h: 16 },
  { label: '16:9', value: '16:9 (Widescreen)', w: 16, h: 9 },
  { label: '21:9', value: '21:9 (Ultrawide)', w: 21, h: 9 },
]

const RATIO_RE = /^(\d{3,5})x(\d{3,5})$/i

function base(url) {
  const raw = String(url || '').trim().replace(/\/+$/, '')
  return raw || DEFAULT_COMFY_URL
}

async function callJson(url, opts = {}, timeoutMs = 30_000) {
  let res
  try {
    res = await fetch(url, { ...opts, signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new Error(`ComfyUI 无响应（${Math.round(timeoutMs / 1000)}s 超时）：请确认本地 ComfyUI 已启动`)
    }
    const detail = err?.cause?.code || err?.message || err
    throw new Error(`连不上本地 ComfyUI（${detail}）：请确认 ComfyUI 正在 ${url.replace(/\/[^/]+$/, '')} 运行`)
  }
  const text = await res.text()
  if (!res.ok) {
    let hint = ''
    try {
      const parsed = JSON.parse(text)
      hint = parsed?.error?.message || parsed?.error || ''
      if (parsed?.node_errors && Object.keys(parsed.node_errors).length) {
        const first = Object.values(parsed.node_errors)[0]
        hint = hint || first?.errors?.[0]?.message || JSON.stringify(first).slice(0, 300)
      }
    } catch { /* 非 JSON */ }
    throw new Error(`ComfyUI 返回 HTTP ${res.status}${hint ? `：${String(hint).slice(0, 400)}` : text ? `：${text.slice(0, 300)}` : ''}`)
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`ComfyUI 响应不是 JSON：${text.slice(0, 200)}`)
  }
}

/** 健康检查：返回版本等信息。 */
export async function comfyStats(baseUrl, timeoutMs = 8000) {
  const d = await callJson(`${base(baseUrl)}/system_stats`, {}, timeoutMs)
  return {
    version: d?.system?.comfyui_version || '',
    python: d?.system?.python_version || '',
    devices: Array.isArray(d?.devices) ? d.devices.map((x) => x.name).filter(Boolean) : [],
  }
}

/** 只读列可用的本地模型清单（来自 /object_info 的 combo 选项）。 */
export async function comfyModels(baseUrl, timeoutMs = 30_000) {
  const info = await callJson(`${base(baseUrl)}/object_info`, {}, timeoutMs)
  const combo = (cls, field) => {
    const spec = info?.[cls]?.input?.required?.[field] ?? info?.[cls]?.input?.optional?.[field]
    const options = spec?.[0]
    return Array.isArray(options) ? options.filter((x) => typeof x === 'string') : []
  }
  return {
    unets: combo('UNETLoader', 'unet_name'),
    clips: combo('CLIPLoader', 'clip_name'),
    vaes: combo('VAELoader', 'vae_name'),
    loras: combo('LoraLoaderModelOnly', 'lora_name'),
  }
}

/** 画幅（像素）→ ResolutionSelector 的 (aspect_ratio, megapixels)。 */
export function aspectForSize(size) {
  const m = String(size || '').trim().match(RATIO_RE)
  if (!m) return { aspect: COMFY_ASPECTS[0].value, megapixels: 1 }
  const w = Number(m[1])
  const h = Number(m[2])
  const target = w / h
  let best = COMFY_ASPECTS[0]
  let diff = Infinity
  for (const a of COMFY_ASPECTS) {
    const d = Math.abs(a.w / a.h - target)
    if (d < diff) { diff = d; best = a }
  }
  const mp = Math.round(((w * h) / 1048576) * 100) / 100
  return { aspect: best.value, megapixels: Math.min(16, Math.max(0.1, mp || 1)) }
}

/** 随机种子（KSampler 的 seed 是大整数；这里取安全整数区间内的大值）。 */
export function randomSeed() {
  // crypto.randomInt 的区间上限是 2^48，不能直接写 2^52
  return crypto.randomInt(1, 2 ** 48)
}

/** 上传一张图到 ComfyUI 的 input 目录，返回可在模板里引用的文件名。 */
export async function comfyUploadImage(baseUrl, { bytes, name = 'ref.png', subfolder = 'openchamber', timeoutMs = 120_000 } = {}) {
  if (!bytes || !bytes.length) throw new Error('参考图为空')
  const fd = new FormData()
  fd.set('image', new Blob([Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes)], { type: 'image/png' }), name)
  fd.set('subfolder', subfolder)
  fd.set('overwrite', 'true')
  const d = await callJson(`${base(baseUrl)}/upload/image`, { method: 'POST', body: fd }, timeoutMs)
  if (!d?.name) throw new Error('ComfyUI 上传接口没有返回文件名')
  // subfolder 需要用 / 拼接，Windows 下的反斜杠 ComfyUI 不认
  return d.subfolder ? `${String(d.subfolder).replace(/\\/g, '/')}/${d.name}` : d.name
}

/**
 * 给 API 模板打桩。只替换模板里已经存在的字段，缺失的字段不新增（避免上游拒绝未知输入）。
 * @param {object} template API 格式提示词
 * @param {object} opts
 */
export function patchTemplate(template, opts = {}) {
  const tpl = JSON.parse(JSON.stringify(template && typeof template === 'object' ? template : {}))
  const ids = Object.keys(tpl)
  const withClass = (cls) => ids.filter((id) => tpl[id]?.class_type === cls)
  const first = (cls) => withClass(cls)[0]
  const warnings = []
  // 严格数字：空串 / null / undefined / 非数字 一律视为「没传」（Number('') === 0 会误伤）
  const num = (v) => {
    if (v === undefined || v === null) return null
    if (typeof v === 'string' && !v.trim()) return null
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }

  const {
    prompt, negative, size, seed, steps, cfg, sampler, scheduler,
    unet, clip, vae, lora, imageName, prefix, denoise,
  } = opts

  // 1) 用户提示词：PrimitiveStringMultiline → TextGenerate 的 prompt 输入
  if (typeof prompt === 'string' && prompt.trim()) {
    const prims = withClass('PrimitiveStringMultiline')
    // 模板里第一个 PrimitiveString 是「用户输入」，第二个是「扩写系统提示词」
    const target = prims[0]
    if (target) tpl[target].inputs.value = prompt.trim()
  }

  // 2) 反向提示词：CLIPTextEncode 里那个纯字符串（不是连线的）
  if (typeof negative === 'string') {
    for (const id of withClass('CLIPTextEncode')) {
      const inp = tpl[id].inputs
      if (inp && typeof inp.text === 'string') inp.text = negative
    }
  }

  // 3) 采样参数
  const samplerNode = first('KSampler')
  if (samplerNode) {
    const inp = tpl[samplerNode].inputs
    const seedNum = num(seed)
    const stepsNum = num(steps)
    const cfgNum = num(cfg)
    if (seedNum !== null) inp.seed = Math.round(seedNum)
    if (stepsNum !== null && inp.steps !== undefined) inp.steps = Math.round(stepsNum)
    if (cfgNum !== null && inp.cfg !== undefined) inp.cfg = cfgNum
    if (typeof sampler === 'string' && sampler.trim() && inp.sampler_name !== undefined) inp.sampler_name = sampler.trim()
    if (typeof scheduler === 'string' && scheduler.trim() && inp.scheduler !== undefined) inp.scheduler = scheduler.trim()
    if (typeof denoise === 'number' && inp.denoise !== undefined) inp.denoise = denoise
  }

  // 4) 画幅：aspect_ratio 与 megapixels 都由 size 换算（显式 aspect/megapixels 优先）
  const resNode = first('ResolutionSelector')
  if (resNode) {
    const inp = tpl[resNode].inputs
    const derived = aspectForSize(size)
    inp.aspect_ratio = (typeof opts.aspect === 'string' && opts.aspect.trim()) ? opts.aspect.trim() : derived.aspect
    const mp = num(opts.megapixels)
    if (inp.megapixels !== undefined) inp.megapixels = mp === null ? derived.megapixels : mp
  }

  // 5) 模型
  const unetNode = first('UNETLoader')
  if (unetNode && typeof unet === 'string' && unet.trim()) tpl[unetNode].inputs.unet_name = unet.trim()
  const clipNode = first('CLIPLoader')
  if (clipNode && typeof clip === 'string' && clip.trim()) tpl[clipNode].inputs.clip_name = clip.trim()
  const vaeNode = first('VAELoader')
  if (vaeNode && typeof vae === 'string' && vae.trim()) tpl[vaeNode].inputs.vae_name = vae.trim()
  const loraNode = first('LoraLoaderModelOnly')
  if (loraNode) {
    if (typeof lora === 'string' && lora.trim()) tpl[loraNode].inputs.lora_name = lora.trim()
  } else if (typeof lora === 'string' && lora.trim()) {
    warnings.push('模板里没有 LoRA 节点，lora 参数被忽略')
  }

  // 6) 参考图：把 LoadImage 的输出接到 TextGenerate 的 image 槽
  if (typeof imageName === 'string' && imageName.trim()) {
    const loadNode = first('LoadImage')
    if (loadNode) {
      tpl[loadNode].inputs.image = imageName.trim()
    } else {
      warnings.push('模板里没有 LoadImage 节点，无法接参考图')
    }
    const textGen = first('TextGenerate')
    if (textGen && loadNode) tpl[textGen].inputs.image = [loadNode, 0]
  }

  // 7) 输出前缀
  if (typeof prefix === 'string' && prefix.trim()) {
    for (const id of withClass('SaveImage')) tpl[id].inputs.filename_prefix = prefix.trim()
  } else {
    for (const id of withClass('SaveImage')) {
      const cur = tpl[id].inputs.filename_prefix
      if (typeof cur === 'string') tpl[id].inputs.filename_prefix = cur.replace(/[^\w.-]/g, '') || 'openchamber'
    }
  }

  return { template: tpl, warnings }
}

/** 提交一个 API 提示词，返回 prompt_id。 */
export async function comfySubmit(baseUrl, apiPrompt, { clientId, timeoutMs = 30_000 } = {}) {
  const d = await callJson(`${base(baseUrl)}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: apiPrompt, client_id: clientId || crypto.randomUUID() }),
  }, timeoutMs)
  if (d?.node_errors && Object.keys(d.node_errors).length) {
    const firstErr = Object.values(d.node_errors)[0]
    const msg = firstErr?.errors?.[0]?.message || firstErr?.errors?.[0]?.details || '模板参数被拒绝'
    throw new Error(`ComfyUI 拒绝了工作流：${String(msg).slice(0, 400)}`)
  }
  if (!d?.prompt_id) throw new Error('ComfyUI 没有返回 prompt_id')
  return d.prompt_id
}

/** 下载一张输出图。 */
export async function comfyDownload(baseUrl, { filename, subfolder = '', type = 'output' }, timeoutMs = 120_000) {
  const qs = new URLSearchParams({ filename, subfolder, type })
  let res
  try {
    res = await fetch(`${base(baseUrl)}/view?${qs}`, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new Error('下载 ComfyUI 输出图超时')
    throw new Error(`下载 ComfyUI 输出图失败：${err?.message || err}`)
  }
  if (!res.ok) throw new Error(`下载 ComfyUI 输出图 HTTP ${res.status}（${filename}）`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * 轮询 /history/{id} 直到完成或失败。
 * @returns {Promise<{images: Array<{filename: string, subfolder: string, type: string}>, status: string}>}
 */
export async function comfyWait(baseUrl, promptId, { timeoutMs = COMFY_TIMEOUT_MS, pollMs = COMFY_POLL_MS, onProgress } = {}) {
  const started = Date.now()
  let queueMisses = 0
  const report = (text) => {
    try {
      const r = onProgress?.(text)
      if (r && typeof r.then === 'function') r.catch(() => {})
    } catch { /* 进度失败不阻断 */ }
  }
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollMs))
    let entry = null
    try {
      const h = await callJson(`${base(baseUrl)}/history/${promptId}`, {}, 20_000)
      entry = h?.[promptId] || null
    } catch { /* 读历史失败继续等 */ }
    if (entry) {
      const status = entry.status?.status_str || 'success'
      if (status === 'error') {
        const msgs = entry.status?.messages || []
        const failMsg = msgs.flatMap((m) => (Array.isArray(m) && m[1]?.message ? [m[1].message] : [])).slice(-2).join('；')
        throw new Error(`ComfyUI 执行失败${failMsg ? `：${failMsg}` : '（无错误详情，请看 ComfyUI 控制台）'}`)
      }
      const images = []
      for (const out of Object.values(entry.outputs || {})) {
        for (const img of out?.images || []) {
          if (img?.filename) images.push({ filename: img.filename, subfolder: img.subfolder || '', type: img.type || 'output' })
        }
      }
      if (images.length) return { images, status }
      throw new Error('ComfyUI 执行完成但没有输出图片：请检查模板里是否有 SaveImage 节点')
    }
    // 历史里还没有：看队列，确认任务还在排队/运行
    try {
      const q = await callJson(`${base(baseUrl)}/queue`, {}, 15_000)
      const running = Array.isArray(q?.queue_running) ? q.queue_running : []
      const pending = Array.isArray(q?.queue_pending) ? q.queue_pending : []
      const stillThere = [...running, ...pending].some((item) => Array.isArray(item) && item[1] === promptId)
      if (!stillThere) {
        queueMisses++
        // 队列里连续两次都找不到，且历史里也没有：任务丢了（被中断或重启）
        if (queueMisses >= 2) throw new Error('ComfyUI 队列里找不到该任务：可能被中断或 ComfyUI 重启过')
      } else {
        queueMisses = 0
        const elapsed = Math.round((Date.now() - started) / 1000)
        const pos = pending.findIndex((item) => Array.isArray(item) && item[1] === promptId)
        report(pos > 0 ? `排队中（前面还有 ${pos} 个任务），已等待 ${elapsed}s` : `本地生成中，已等待 ${elapsed}s`)
      }
    } catch (err) {
      if (String(err?.message || '').includes('队列里找不到')) throw err
    }
  }
  throw new Error(`ComfyUI 生成超时（${Math.round(timeoutMs / 1000)}s）：可调大设置里的超时时间，或检查显存是否够用`)
}

/**
 * 一次完整的本地生成：打桩 → 提交 → 等待 → 下载。
 * @returns {Promise<{images: Buffer[], promptId: string, warnings: string[]}>}
 */
export async function runComfyWorkflow({ baseUrl, template, patch, timeoutMs, pollMs, onProgress }) {
  if (!template || typeof template !== 'object' || !Object.keys(template).length) {
    throw new Error('工作流模板为空')
  }
  const { template: apiPrompt, warnings } = patchTemplate(template, patch)
  onProgress?.('提交到本地 ComfyUI…')
  const promptId = await comfySubmit(baseUrl, apiPrompt)
  const done = await comfyWait(baseUrl, promptId, { timeoutMs, pollMs, onProgress })
  onProgress?.('下载本地输出…')
  const images = []
  for (const img of done.images) {
    images.push(await comfyDownload(baseUrl, img))
  }
  return { images, promptId, warnings }
}
