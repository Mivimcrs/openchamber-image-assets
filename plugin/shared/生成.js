// 共享纯逻辑：生图内核（对话工具与扩展服务共用的唯一实现）。
//
// 这些写法来自实际网关的行为约定：
//   - response_format=b64_json 可能被忽略，返回的是图片 URL → URL 下载是主路径
//   - size 不严格校验、可能半透传 → 只做形态校验，实际尺寸由调用方入库时对照
//   - 错误响应 body 常为空 → 只能按状态码映射
//   - 透明背景只在文生图可用 → 参考图模式下不传该参数，只给提示
//   - n>1 可用 → 一次请求多张
// 单次请求纪律：不重试、不循环；失败就把原因抛出去。

export const SIZE_PRESETS = [
  { label: '1:1', size: '1024x1024' },
  { label: '2:3', size: '1024x1536' },
  { label: '3:2', size: '1536x1024' },
  { label: '3:4', size: '1152x1536' },
  { label: '4:3', size: '1536x1152' },
  { label: '16:9', size: '1536x864' },
  { label: '9:16', size: '864x1536' },
]

export const MAX_REFERENCES = 4
export const MAX_COUNT = 4
export const GEN_TIMEOUT_MS = 300_000

const SIZE_RE = /^(\d{3,5})x(\d{3,5})$/i
const MIME_BY_EXT = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }

export function validateSize(size, fallback = '1024x1536') {
  const raw = typeof size === 'string' ? size.trim().toLowerCase() : ''
  const m = raw.match(SIZE_RE)
  if (!m) return fallback
  const w = Number(m[1])
  const h = Number(m[2])
  if (w < 256 || h < 256 || w > 4096 || h > 4096) return fallback
  return `${w}x${h}`
}

export function mimeForName(name) {
  const ext = String(name || '').split('.').pop().toLowerCase()
  return MIME_BY_EXT[ext] || 'image/png'
}

export function endpointFor(images) {
  return Array.isArray(images) && images.length ? '/images/edits' : '/images/generations'
}

/** 状态码 → 人能看懂的原因。网关错误 body 通常为空，所以这里是唯一的信息来源。 */
export function mapHttpError(status, endpoint = '/images/generations', bodyText = '') {
  const snippet = String(bodyText || '').replace(/\s+/g, ' ').trim().slice(0, 300)
  const tail = snippet ? `；响应片段：${snippet}` : '（响应体为空）'
  const where = endpoint === '/images/edits' ? '参考图生图' : '文生图'
  switch (status) {
    case 400:
      return `${where}被拒（HTTP 400）：多为图片格式/体积不被接受或参数组合非法${tail}`
    case 401:
    case 403:
      return `${where}密钥被拒绝（HTTP ${status}）：请在扩展设置里检查密钥${tail}`
    case 404:
      return `${where}接口不存在（HTTP 404）：请检查 API 地址是否正确${tail}`
    case 413:
      return `${where}请求体过大（HTTP 413）：参考图请压到 10MB 以内${tail}`
    case 429:
      return `${where}触发限流（HTTP 429）：稍后再试${tail}`
    case 500:
    case 502:
    case 503:
    case 504:
      return `${where}上游失败（HTTP ${status}）：网关或模型侧错误，与本地参数无关${tail}`
    default:
      return `${where}失败（HTTP ${status}）${tail}`
  }
}

/**
 * 一次生成请求。
 * @param {object} opts
 * @param {string} opts.baseUrl
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {string} opts.prompt
 * @param {string} opts.size
 * @param {number} opts.count
 * @param {Array<{bytes: Buffer|Uint8Array, mime?: string, name?: string}>} [opts.images]
 * @param {boolean} [opts.transparent]
 * @param {number} [opts.timeoutMs]
 * @param {(text: string) => void | Promise<void>} [onProgress]
 * @returns {Promise<{endpoint: string, requestedSize: string, results: Array<{bytes: Buffer, mode: string}>, usage: object|null, warnings: string[]}>}
 */
export async function requestImages(opts, onProgress) {
  const {
    baseUrl, apiKey, model, prompt, size, count = 1, images = [], transparent = false,
  } = opts
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : GEN_TIMEOUT_MS
  const base = String(baseUrl || '').replace(/\/+$/, '')
  if (!base) throw new Error('API 地址未配置')
  if (!apiKey) throw new Error('密钥未配置')
  const text = typeof prompt === 'string' ? prompt.trim() : ''
  if (!text) throw new Error('提示词不能为空')

  const endpoint = endpointFor(images)
  const requestedSize = validateSize(size)
  const n = Math.min(MAX_COUNT, Math.max(1, Math.round(Number(count) || 1)))
  const warnings = []
  if (images.length && images.length > MAX_REFERENCES) {
    throw new Error(`参考图最多 ${MAX_REFERENCES} 张`)
  }
  if (images.length && transparent) {
    warnings.push('参考图模式下未传透明背景参数（该组合尚未验证），出图可能不是透明底')
  }

  const trans = (label) => { try { const r = onProgress?.(label); if (r && typeof r.then === 'function') r.catch(() => {}) } catch { /* 进度失败不阻断 */ } }

  trans(images.length ? `提交参考图生图（${images.length} 张参考图）…` : '提交文生图请求…')

  let res
  try {
    if (endpoint === '/images/edits') {
      const fd = new FormData()
      fd.set('model', model)
      fd.set('prompt', text)
      fd.set('size', requestedSize)
      fd.set('n', String(n))
      for (const [i, img] of images.entries()) {
        const bytes = Buffer.isBuffer(img.bytes) ? img.bytes : Buffer.from(img.bytes)
        fd.append('image', new Blob([bytes], { type: img.mime || mimeForName(img.name) }), img.name || `ref-${i + 1}.png`)
      }
      res = await fetch(`${base}${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: fd,
        signal: AbortSignal.timeout(timeoutMs),
      })
    } else {
      const body = { model, prompt: text, n, size: requestedSize }
      if (transparent) {
        body.background = 'transparent'
        body.output_format = 'png'
      }
      res = await fetch(`${base}${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    }
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new Error(`生成超时（${Math.round(timeoutMs / 1000)}s）：网关未在时限内返回`)
    }
    throw new Error(`网络错误：${err?.message || err}`)
  }

  const bodyText = await res.text()
  if (!res.ok) throw new Error(mapHttpError(res.status, endpoint, bodyText))

  let parsed
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    throw new Error(`响应不是 JSON：${bodyText.slice(0, 200)}`)
  }
  const items = Array.isArray(parsed?.data) ? parsed.data : []
  if (!items.length) throw new Error('响应里没有图片数据')

  trans('下载图片…')
  const results = []
  for (const item of items) {
    if (item?.b64_json) {
      results.push({ bytes: Buffer.from(String(item.b64_json).replace(/\s/g, ''), 'base64'), mode: 'b64' })
      continue
    }
    if (item?.url) {
      const bytes = await downloadImage(item.url, timeoutMs)
      results.push({ bytes, mode: 'url' })
      continue
    }
    throw new Error('响应缺少 b64_json 与 url')
  }

  return {
    endpoint,
    requestedSize,
    results,
    usage: parsed?.usage && typeof parsed.usage === 'object' ? parsed.usage : null,
    warnings,
    model,
    prompt: text,
    count: n,
  }
}

/** 下载接口返回的图片（常见为公网直链，无需伪装 UA）。 */
export async function downloadImage(url, timeoutMs = 120_000) {
  if (!/^https?:\/\//i.test(String(url))) throw new Error('图片地址不是 http(s)')
  let res
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new Error('下载图片超时')
    throw new Error(`下载图片失败：${err?.message || err}`)
  }
  if (!res.ok) throw new Error(`下载图片 HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

/** 只读拉模型清单（不耗生成额度）。 */
export async function fetchModels({ baseUrl, apiKey, timeoutMs = 30_000 }) {
  const base = String(baseUrl || '').replace(/\/+$/, '')
  if (!base) throw new Error('API 地址未配置')
  if (!apiKey) throw new Error('密钥未配置')
  let res
  try {
    res = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') throw new Error('模型清单请求超时')
    throw new Error(`模型清单不可达：${err?.message || err}`)
  }
  const text = await res.text()
  if (res.status === 401 || res.status === 403) throw new Error(`密钥被拒绝（HTTP ${res.status}）`)
  if (!res.ok) throw new Error(`模型清单查询失败（HTTP ${res.status}）`)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('模型清单响应无法解析')
  }
}

/** 给模型看的失败报告（单次纪律：不自动重试）。 */
export function failureReport(stage, detail) {
  return [
    `生图失败（阶段：${stage}）：${detail}`,
    '单次请求纪律：不要自动重试。请把失败原因报告给用户，经用户确认后再重新调用本工具；重发前先复述将要使用的模型与提示词要点。',
  ].join('\n')
}
