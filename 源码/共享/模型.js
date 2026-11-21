// 共享纯逻辑：图像模型能力表（按公开的模型能力填写，写在代码里而不是猜）。
//
// 字段含义：
//   text2img   文生图（/images/generations）
//   img2img    参考图生图（/images/edits）
//   transparent 透明背景（background=transparent + output_format=png）
//   honorsSize  是否按请求的 size 出图
// 值为 null 一律表示「未验证」，界面必须显示「未验证」，不得当成支持。
// 表里没有的模型也能用，只是能力未知；想改标签直接改这里。

export const MODEL_CAPS = {
  'gpt-image-2.6-sunburst': {
    text2img: true, img2img: true, transparent: true, honorsSize: true,
    note: '文生图与参考图生图均可用，尺寸按请求返回',
  },
  'gpt-image-2.6-flare': {
    text2img: null, img2img: null, transparent: null, honorsSize: null,
    note: '清单里有，能力未验证',
  },
  'nano-banana-2.1': {
    text2img: null, img2img: true, transparent: null, honorsSize: false,
    note: '忽略 size，按模型自身 2K 出图',
  },
  'nano-banana-pro': {
    text2img: null, img2img: null, transparent: null, honorsSize: null,
    note: '清单里有，能力未验证',
  },
}

export const KNOWN_MODELS = Object.keys(MODEL_CAPS)

const IMAGE_RE = /image|flux|dall|imagine|sdxl|sd-|playground|nano-banana|seedream|kolors|wanx/i

/** 某模型的能力；未登记的模型全部为未验证，但不算非法（允许自定义 id）。 */
export function capsFor(id) {
  const key = String(id || '').trim()
  const found = MODEL_CAPS[key]
  if (found) return { id: key, known: true, ...found }
  return {
    id: key, known: false,
    text2img: null, img2img: null, transparent: null, honorsSize: null,
    note: '未登记的模型，能力未知',
  }
}

/** 从 /v1/models 清单里挑图像模型：已知名单 + 名称特征。 */
export function pickImageModelIds(payload) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : []
  const ids = list
    .map((m) => (typeof m === 'string' ? m : m?.id))
    .filter((id) => typeof id === 'string' && (MODEL_CAPS[id] || IMAGE_RE.test(id)))
  return [...new Set(ids)]
}

/** 模型清单 → 带能力标签的列表，已知模型排前面。 */
export function describeModels(payload) {
  return pickImageModelIds(payload)
    .map((id) => capsFor(id))
    .sort((a, b) => Number(b.known) - Number(a.known) || a.id.localeCompare(b.id))
}

export const CAP_LABEL = {
  text2img: '文生图',
  img2img: '图生图',
  transparent: '透明',
  honorsSize: '按尺寸',
}
