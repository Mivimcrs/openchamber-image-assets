// 共享纯逻辑：密钥校验、图片头解析、模型清单判断、回退决策。
// 不依赖任何第三方包，插件侧与服务侧共用（插件侧复制同名副本以保持零依赖加载）。

const PLACEHOLDER_RE = /^<|你的密钥|REPLACE|sk-xxx|changeme|placeholder/i

/** 校验密钥形态：非空、非占位符、sk- 前缀（警告不阻断）。返回 {ok, error, warning} */
export function checkKey(value) {
  const v = typeof value === 'string' ? value.trim() : ''
  if (!v) return { ok: false, error: '密钥未配置' }
  if (PLACEHOLDER_RE.test(v)) return { ok: false, error: '密钥仍是占位符，不是真实密钥' }
  if (!v.startsWith('sk-')) return { ok: true, warning: '密钥不以 sk- 开头，仍按原值使用' }
  return { ok: true }
}

// ---- 图片头解析（PNG / JPEG）----

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function sniffImage(bytes) {
  if (!bytes || bytes.length < 12) return null
  const isPng = PNG_MAGIC.every((b, i) => bytes[i] === b)
  if (isPng) {
    // IHDR 固定在 8 字节签名 + 4 长度 + 4 类型之后
    if (bytes.length < 24 || String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]) !== 'IHDR') return null
    const width = readU32(bytes, 16)
    const height = readU32(bytes, 20)
    return width > 0 && height > 0 ? { type: 'png', width, height } : null
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i++; continue }          // 填充字节
      const marker = bytes[i + 1]
      if (marker === 0xff) { i++; continue }             // 连续 ff
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue } // 无长度段
      const len = (bytes[i + 2] << 8) | bytes[i + 3]
      if (len < 2) return null
      const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isSof) {
        const height = (bytes[i + 5] << 8) | bytes[i + 6]
        const width = (bytes[i + 7] << 8) | bytes[i + 8]
        return width > 0 && height > 0 ? { type: 'jpg', width, height } : null
      }
      if (marker === 0xda) return null                   // 到压缩数据还没找到 SOF
      i += 2 + len
    }
    return null
  }
  return null
}

function readU32(b, off) {
  return ((b[off] << 24) | (b[off + 1] << 16) | (b[off + 2] << 8) | b[off + 3]) >>> 0
}

// ---- 模型清单 ----

/** GET /v1/models 响应（兼容 data 或 顶层数组）里是否包含模型 id */
export function modelsInclude(payload, modelId) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : []
  return list.some((m) => (typeof m === 'string' ? m : m?.id) === modelId)
}

/** 从模型清单里挑出疑似图像模型 id */
export function pickImageModels(payload) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : []
  return list
    .map((m) => (typeof m === 'string' ? m : m?.id))
    .filter((id) => typeof id === 'string' && /image|flux|dall|imagine|sdxl|sd-|playground/i.test(id))
    .slice(0, 20)
}

// ---- 生成失败后的回退决策 ----

/**
 * 判断生成失败是否因为 response_format 参数不被支持 → 可回退 URL 模式。
 * 只有明确指向参数问题才回退；503/超时/额度/鉴权等一律不回退。
 */
export function shouldFallbackToUrl(message) {
  const m = String(message || '')
  if (/response_format/i.test(m)) return true
  return /unknown (parameter|field)|unexpected keyword|extra (input|field|parameter)|not (permitted|supported|allowed)/i.test(m)
}

/** 把一次失败翻译成给模型看的结构化报告（单次纪律：不自动重试） */
export function failureReport(stage, detail) {
  return [
    `生图失败（阶段：${stage}）：${detail}`,
    '单次请求纪律：不要自动重试。请把失败原因报告给用户，经用户确认后再重新调用本工具；重发前先复述将要使用的模型与提示词要点。',
  ].join('\n')
}
