/**
 * OpenCode 插件：注册 image_assets_* 工具（文生图 / 参考图生图 / 视频占位 + 状态查询）。
 *
 * 路由：按扩展设置里的「接口」决定走哪条链路
 *   - kind=cloud：云端图片 API（/images/generations 或 /images/edits）
 *   - kind=local：本地 ComfyUI（模板 t2i / i2i / video，模板来自扩展 工作流/ 或接口里指定的路径）
 * 默认接口与默认模型都由用户在面板里手动设定；调用时可用 interface / model 显式覆盖。
 *
 * 单次请求纪律：不重试，失败即抛结构化报告。
 * 零第三方依赖：shared/ 下的纯逻辑由构建脚本从 源码/共享 同步进来。
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkKey, sniffImage, modelsInclude, pickImageModels } from './shared/校验.js'
import { ensureLibrary, saveAsset, findAsset, cacheReference, insideLibrary } from './shared/资产库.js'
import { readSettings, resolveInterface, describeInterfaces, KIND_LABEL, libraryRoot } from './shared/配置.js'
import { resolveApiKey } from './shared/密钥.js'
import { generateWithInterface, describeRoute } from './shared/统一生成.js'
import { failureReport, fetchModels, validateSize, mimeForName, MAX_REFERENCES, MAX_COUNT } from './shared/生成.js'
import { comfyStats } from './shared/ComfyUI.js'
import { describeTemplate, SLOTS, SLOT_LABEL } from './shared/工作流.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT_ROOT = path.resolve(HERE, '..')
const REF_MAX_BYTES = 20 * 1024 * 1024

/**
 * 资产库根目录在**每次调用时**解析：面板里换了自定义路径后，
 * 插件下一次调用就跟着走，不需要重启 OpenChamber。
 * 优先级：环境变量 IMAGE_ASSETS_ROOT > 自定义路径 > 用户主目录默认。
 */
function libRoot() {
  return libraryRoot()
}

// ---- 模型预检（只读，不耗生成额度）----

async function assertModelAvailable({ iface, apiKey, model }) {
  if (iface.kind === 'local') return { warning: '' } // 本地模型名由模板决定，不预检
  let payload
  try {
    payload = await fetchModels({ baseUrl: iface.baseUrl, apiKey })
  } catch (err) {
    return { warning: `${err.message}，跳过预检直接尝试生成` }
  }
  if (!modelsInclude(payload, model)) {
    const alternatives = pickImageModels(payload)
    throw new Error(failureReport(
      '预检',
      `模型「${model}」不在役` +
      (alternatives.length ? `；可用图像模型：${alternatives.join('、')}` : '；清单里没有可用图像模型'),
    ))
  }
  return { warning: '' }
}

// ---- 参考图解析：本地路径 / asset:<id> ----

function readReference(root, raw) {
  const token = String(raw || '').trim()
  if (!token) throw new Error('参考图为空字符串')

  if (token.startsWith('asset:')) {
    const id = token.slice(6)
    const rec = findAsset(root, id)
    if (!rec) throw new Error(`参考图资产不存在：${id}`)
    const abs = insideLibrary(root, rec.file)
    if (!abs) throw new Error('参考图路径越界')
    const bytes = readFileSync(abs)
    return { bytes, name: path.basename(rec.file), mime: mimeForName(rec.file), assetId: rec.id }
  }

  const abs = path.isAbsolute(token) ? token : path.resolve(token)
  let st
  try {
    st = statSync(abs)
  } catch {
    throw new Error(`参考图不存在：${token}`)
  }
  if (!st.isFile()) throw new Error(`参考图不是文件：${token}`)
  if (st.size > REF_MAX_BYTES) throw new Error(`参考图过大（${(st.size / 1048576).toFixed(1)}MB，上限 20MB）：${token}`)
  const bytes = readFileSync(abs)
  const name = path.basename(abs)
  if (!sniffImage(bytes)) throw new Error(`参考图不是有效 PNG/JPEG：${token}`)
  return { bytes, name, mime: mimeForName(name), localPath: abs }
}

/** 把本地参考图复制进库缓存，让面板能显示缩略图；asset: 引用不需要复制。 */
function referenceRecord(root, ref) {
  if (ref.assetId) return { kind: 'asset', id: ref.assetId, name: ref.name }
  const file = cacheReference(root, ref.bytes, ref.name)
  return { kind: 'path', path: ref.localPath, file, name: ref.name }
}

function summarizeUsage(usage) {
  if (!usage || typeof usage !== 'object') return ''
  const total = usage.total_tokens
  const img = usage.output_tokens_details?.image_tokens ?? usage.completion_tokens_details?.image_tokens
  if (!Number.isFinite(total) && !Number.isFinite(img)) return ''
  const parts = []
  if (Number.isFinite(total)) parts.push(`${total} tokens`)
  if (Number.isFinite(img)) parts.push(`其中图片 ${img}`)
  return parts.join('，')
}

/** 解析本次要用的接口 / 密钥 / 模型，失败一律给结构化报告。 */
function prepare(opts = {}) {
  const settings = readSettings(libRoot())
  const wanted = typeof opts.interfaceId === 'string' ? opts.interfaceId.trim() : ''
  const picked = resolveInterface(settings, wanted)
  if (!picked.interface) {
    const list = describeInterfaces(settings)
    throw new Error(failureReport(
      '配置',
      picked.error +
      (list.length ? `；现有接口：${list.map((it) => `${it.name}(${it.id}·${it.kindLabel})`).join('、')}` : ''),
    ))
  }
  const iface = picked.interface
  const resolved = resolveApiKey(libRoot(), iface)
  if (iface.kind === 'cloud') {
    if (!resolved.key) throw new Error(failureReport('配置', resolved.error || '密钥未配置'))
    const verdict = checkKey(resolved.key)
    if (!verdict.ok) throw new Error(failureReport('配置', verdict.error))
  }
  const model = typeof opts.model === 'string' && opts.model.trim()
    ? opts.model.trim()
    : (iface.defaultModel || '')
  return { settings, iface, resolved, model }
}

async function commonGenerate(input, context, ctx, { slot = '', progress } = {}) {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
  if (!prompt) throw new Error('prompt 不能为空')

  const prepared = prepare({ interfaceId: input.interface, model: input.model })
  const { settings, iface, resolved, model } = prepared
  if (iface.kind === 'cloud' && !model) {
    throw new Error(failureReport('配置', `接口「${iface.name}」没有默认模型：请在面板里设定，或调用时传 model`))
  }

  const size = validateSize(input.size || settings.defaultSize, settings.defaultSize)
  const count = iface.kind === 'local'
    ? 1
    : Math.min(MAX_COUNT, Math.max(1, Math.round(Number(input.count) || settings.defaultCount || 1)))
  const transparent = input.transparent === true

  const inputImages = Array.isArray(input.images) ? input.images.filter((s) => typeof s === 'string' && s.trim()) : []
  if (inputImages.length > MAX_REFERENCES) throw new Error(`参考图最多 ${MAX_REFERENCES} 张（收到 ${inputImages.length} 张）`)
  if (slot === 'i2i' && !inputImages.length) throw new Error('图生图需要至少 1 张参考图')
  if (iface.kind === 'local' && slot === 't2i' && inputImages.length) throw new Error('文生图不接受参考图；要带参考图请用图生图工具')

  let refs = []
  if (inputImages.length) {
    await progress?.(`读取参考图（${inputImages.length} 张）…`)
    refs = inputImages.map((raw) => readReference(libRoot(), raw))
  }

  // 会话上下文：资产记录要能对上「本次会话」
  let sessionId = context?.sessionID || null
  let sessionTitle = null
  let projectDirectory = null
  try {
    if (sessionId && ctx.session?.get) {
      const s = await ctx.session.get({ sessionID: sessionId })
      sessionTitle = s?.title || null
    }
  } catch { /* 标题拿不到不阻断生成 */ }
  try {
    projectDirectory = ctx.location?.directory || null
  } catch { /* 可选字段 */ }

  if (iface.kind === 'cloud') {
    await progress?.('核验模型…')
  } else {
    await progress?.(`本地工作流：${iface.baseUrl}`)
  }
  const pre = await assertModelAvailable({ iface, apiKey: resolved.key, model })

  let out
  try {
    out = await generateWithInterface({
      iface,
      apiKey: resolved.key,
      extRoot: EXT_ROOT,
      prompt,
      size,
      count,
      images: refs,
      transparent,
      model,
      slot,
    }, progress)
  } catch (err) {
    throw new Error(failureReport(slot === 'video' ? '视频' : '生成', String(err?.message || err)))
  }

  await progress?.('验证图片并入库…')
  const libPaths = ensureLibrary(libRoot())
  const refRecords = refs.map((r) => referenceRecord(libRoot(), r))
  const saved = []
  for (const [i, result] of out.results.entries()) {
    const info = sniffImage(result.bytes)
    if (!info) {
      mkdirSync(libPaths.runtime, { recursive: true })
      const dump = path.join(libPaths.runtime, `无效响应-${Date.now()}-${i}.bin`)
      writeFileSync(dump, result.bytes)
      throw new Error(failureReport('验证', `第 ${i + 1} 张不是有效 PNG/JPEG（原字节已留存 ${dump}）`))
    }
    const record = saveAsset(libRoot(), result.bytes, {
      sessionId,
      sessionTitle,
      projectDirectory,
      prompt: out.prompt,
      model: out.model,
      apiSize: out.requestedSize,
      requestedSize: out.requestedSize,
      width: info.width,
      height: info.height,
      format: info.type,
      alpha: info.type === 'png',
      source: iface.kind === 'local' ? 'comfyui' : 'cloud',
      interfaceId: iface.id,
      interfaceName: iface.name,
      interfaceKind: iface.kind,
      baseUrl: iface.baseUrl,
      endpoint: out.endpoint,
      workflow: out.slot || '',
      referenceIds: refRecords.filter((r) => r.kind === 'asset').map((r) => r.id),
      references: refRecords,
      usage: out.usage,
      tags: Array.isArray(input.tags) ? input.tags : [],
      note: typeof input.note === 'string' ? input.note : '',
    })
    saved.push({ record, info })
  }

  const warnings = [resolved.warning, pre.warning, ...out.warnings].filter(Boolean)
  const where = iface.kind === 'local' ? `本地 ComfyUI · ${SLOT_LABEL[out.slot] || out.slot}` : `云端 ${iface.baseUrl}`
  const lines = [
    saved.length === 1
      ? `已生成并入库：${path.join(libRoot(), saved[0].record.file)}`
      : `已生成 ${saved.length} 张并入库：`,
    ...(saved.length === 1 ? [] : saved.map((s, i) => `  ${i + 1}. ${path.join(libRoot(), s.record.file)}`)),
    `接口 ${iface.name}（${KIND_LABEL[iface.kind]}，${where}）`,
    `模型 ${out.model || model}，请求尺寸 ${out.requestedSize}` +
      `，实际 ${saved[0].info.width}x${saved[0].info.height}` +
      (saved.length > 1 ? '（首张）' : ''),
    refRecords.length ? `参考图 ${refRecords.length} 张：${refRecords.map((r) => r.name).join('、')}` : '',
    summarizeUsage(out.usage) ? `用量：${summarizeUsage(out.usage)}` : '',
    `资产 id：${saved.map((s) => s.record.id).join('、')}`,
    '侧边栏「Magic Raw Picture」面板的“本次会话”与“全部资产”里都能看到它。',
    warnings.length ? `提示：${warnings.join('；')}` : '',
  ]
  return { content: lines.filter(Boolean).join('\n'), saved, out, iface }
}

const IMAGES_DESC = `参考图（最多 ${MAX_REFERENCES} 张）：本地绝对路径，或 asset:<资产id>（引用资产库里的图）`

const plugin = {
  id: 'openchamber-image-assets',
  async setup(ctx) {
    const registration = await ctx.tool.transform((editor) => {
      editor.namespace({
        name: 'image_assets',
        description: 'Magic Raw Picture：多接口（云端 API / 本地 ComfyUI）文生图、图生图、视频与资产管理',
      })

      // ---- 文生图 / 图生图 ----
      editor.add({
        name: 'generate',
        description:
          '生成图片并自动存入生图资产库（侧边栏可查看、标注、删除）。' +
          '走哪个接口由扩展设置里的「默认接口」决定，也可以用 interface 传接口 id 临时指定；' +
          '接口类型为云端时走图片 API，类型为本地时走本机 ComfyUI 工作流。' +
          '传 images（本地路径或 asset:<资产id>）时走图生图，不传则走文生图。' +
          '流程：解析接口与密钥 → 只读核验模型（云端）→ 单次生成 → 验证图片头 → 入库。' +
          '失败时工具会给出结构化报告：不要自动重试，把原因报告给用户，' +
          '经用户确认并复述模型与提示词要点后再重新调用。',
        input: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: '完整生图提示词：按【构图与透视】【人物动作】【人物外貌】【场景】【光线与阴影】【画质】分段描述；图生图时明确写清「保留什么、只改什么」',
            },
            images: { type: 'array', items: { type: 'string' }, description: IMAGES_DESC },
            size: {
              type: 'string',
              description: '画幅，形如 1024x1536；不传用扩展设置里的默认画幅（云端接口不严格校验，本地按最接近的画幅比换算）',
            },
            count: {
              type: 'integer', minimum: 1, maximum: 4,
              description: '一次生成几张（仅云端接口生效；本地工作流一次 1 张），默认 1',
            },
            transparent: {
              type: 'boolean',
              description: '透明背景（仅云端文生图验证过；与 images 同时使用不生效）',
            },
            model: {
              type: 'string',
              description: '模型 id，覆盖接口里设定的默认模型；云端会先对 /v1/models 核验',
            },
            interface: {
              type: 'string',
              description: '接口 id（不传则用面板里手动设定的默认接口）',
            },
            tags: { type: 'array', items: { type: 'string' }, description: '资产标签（可选），便于侧边栏筛选' },
            note: { type: 'string', description: '资产备注（可选），最多 2000 字' },
          },
          required: ['prompt'],
          additionalProperties: false,
        },
        options: { namespace: 'image_assets', codemode: false },
        execute: async (input, context) => {
          const progress = async (status) => {
            try {
              await context?.progress?.({ status })
            } catch { /* 进度上报失败不阻断 */ }
          }
          const r = await commonGenerate(input, context, ctx, { progress })
          return { content: r.content }
        },
      })

      // ---- 视频（本机无视频模型：只留接口与模板位）----
      editor.add({
        name: 'generate_video',
        description:
          '用本地 ComfyUI 的视频工作流生成视频（当前占位：本机未安装任何视频模型）。' +
          '需要先在面板「设置 → 接口 → 本地 ComfyUI」里填入视频工作流模板路径。' +
          '该工具当前没有可用的已产出验证，调用前请先确认用户已装好视频模型与工作流。',
        input: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: '视频提示词：写清主体、动作、镜头运动、时长与首帧构图' },
            images: { type: 'array', items: { type: 'string' }, description: `首帧参考图（最多 ${MAX_REFERENCES} 张）：本地绝对路径或 asset:<资产id>` },
            interface: { type: 'string', description: '本地 ComfyUI 接口 id（不传则用默认接口）' },
            size: { type: 'string', description: '画幅，形如 1024x576' },
            tags: { type: 'array', items: { type: 'string' }, description: '资产标签（可选）' },
            note: { type: 'string', description: '资产备注（可选）' },
          },
          required: ['prompt'],
          additionalProperties: false,
        },
        options: { namespace: 'image_assets', codemode: false },
        execute: async (input, context) => {
          const progress = async (status) => {
            try {
              await context?.progress?.({ status })
            } catch { /* 忽略 */ }
          }
          const prepared = prepare({ interfaceId: input.interface })
          if (prepared.iface.kind !== 'local') {
            throw new Error(failureReport('配置', `视频生成只走本地 ComfyUI；当前接口「${prepared.iface.name}」是云端接口，请在面板里新建一个本地接口并设为默认`))
          }
          const tpl = describeTemplate(EXT_ROOT, 'video', prepared.iface.comfy?.workflows?.video)
          if (!tpl.path || !tpl.exists) {
            throw new Error(failureReport('配置',
              '视频工作流还没配置：请在面板「设置 → 接口 → 本地 ComfyUI → 工作流」里填入视频模板路径。' +
              '本机目前没有任何视频模型（8GB 显存），需要先装模型与工作流，再按 README 的提取步骤生成 API 模板。'))
          }
          const r = await commonGenerate({ ...input, count: 1 }, context, ctx, { slot: 'video', progress })
          return { content: r.content }
        },
      })

      // ---- 状态：接口、模型、工作流、连通性 ----
      editor.add({
        name: 'status',
        description:
          '列出已配置的接口（云端 / 本地）、每个接口的默认模型、密钥是否就绪、本地 ComfyUI 的连通性与工作流模板状态。' +
          '排障或不确定该用哪个接口时先调用它（只读，不生成、不花钱）。',
        input: {
          type: 'object',
          properties: {
            probe: { type: 'boolean', description: '是否顺带探测本地 ComfyUI 是否在线（默认 true）' },
          },
          additionalProperties: false,
        },
        options: { namespace: 'image_assets', codemode: false },
        execute: async (input) => {
          const settings = readSettings(libRoot())
          const list = describeInterfaces(settings)
          const lines = []
          if (!list.length) {
            lines.push('还没有配置任何接口：请在面板「设置 → 接口」里添加云端接口或本地 ComfyUI。')
          }
          for (const it of list) {
            const iface = settings.interfaces.find((x) => x.id === it.id) || it
            const resolved = resolveApiKey(libRoot(), iface)
            const marks = []
            marks.push(it.isDefault ? '★ 默认' : '未设为默认')
            marks.push(it.enabled ? '启用' : '停用')
            marks.push(it.kindLabel)
            lines.push(`- ${it.name}（${it.id}）：${marks.join(' / ')}`)
            lines.push(`    地址 ${it.baseUrl || '(未填)'}`)
            if (it.kind === 'cloud') {
              lines.push(`    默认模型 ${it.defaultModel || '(未设)'}；手填模型 ${it.models.length} 个；密钥 ${resolved.key ? '就绪' : '缺失'}`)
            } else {
              const route = describeRoute(iface, EXT_ROOT, [])
              for (const slot of SLOTS) {
                const t = describeTemplate(EXT_ROOT, slot, iface.comfy?.workflows?.[slot])
                lines.push(`    ${t.label}模板：${t.exists ? `${t.path}（${t.nodes} 节点）` : (t.path ? `缺失 ${t.path}` : '未配置')}`)
              }
              if (input.probe !== false) {
                try {
                  const stats = await comfyStats(it.baseUrl)
                  lines.push(`    ComfyUI 在线：${stats.version}${stats.devices.length ? `（${stats.devices.join('、')}）` : ''}`)
                } catch (err) {
                  lines.push(`    ComfyUI 不可用：${err.message}`)
                }
              }
            }
          }
          lines.push('', `默认接口：${settings.defaultInterface || '(未设定：多接口时必须手动指定)'}`)
          lines.push(`默认画幅：${settings.defaultSize}；默认张数：${settings.defaultCount}`)
          lines.push(`资产库：${libRoot()}`)
          return { content: lines.join('\n') }
        },
      })
    })
    return () => registration.dispose().catch(() => {})
  },
}

export default plugin
