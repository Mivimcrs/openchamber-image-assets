// 共享纯逻辑：工作流模板的解析与加载。
//
// 模板是 ComfyUI 的 API 格式提示词（JSON 对象：节点 id → {class_type, inputs}）。
// 默认使用扩展自带的 工作流/ 目录里的模板；接口配置里填了路径就优先用那个文件。
//
// 只依赖 node:fs / node:path。

import fs from 'node:fs'
import path from 'node:path'

export const SLOTS = ['t2i', 'i2i', 'video']

export const SLOT_LABEL = { t2i: '文生图', i2i: '图生图', video: '视频' }

/** 扩展自带的模板文件名（放在扩展根的 工作流/ 下）。 */
export const BUNDLED = {
  t2i: 't2i_moss_sft.api.json',
  i2i: 'i2i_moss_sft.api.json',
  video: '',
}

export function bundledDir(extRoot) {
  return path.join(extRoot, '工作流')
}

/**
 * 解析某个槽位实际要用的模板文件。
 * @param {string} extRoot 扩展根目录
 * @param {string} slot t2i | i2i | video
 * @param {string} [customPath] 接口配置里的自定义路径
 * @returns {{path: string, source: 'custom'|'bundled'|'none', exists: boolean}}
 */
export function templatePath(extRoot, slot, customPath) {
  const custom = typeof customPath === 'string' ? customPath.trim() : ''
  if (custom) {
    return { path: custom, source: 'custom', exists: fs.existsSync(custom) }
  }
  const name = BUNDLED[slot]
  if (!name) return { path: '', source: 'none', exists: false }
  const p = path.join(bundledDir(extRoot), name)
  return { path: p, source: 'bundled', exists: fs.existsSync(p) }
}

/** 读模板；不存在或不是合法对象时抛错（错误信息给人看）。 */
export function loadTemplate(extRoot, slot, customPath) {
  const resolved = templatePath(extRoot, slot, customPath)
  if (!resolved.path) {
    throw new Error(`还没有配置${SLOT_LABEL[slot]}工作流：请在面板「设置 → 接口」里为本地接口指定${SLOT_LABEL[slot]}模板路径（或把模板放到扩展的 工作流/ 目录）`)
  }
  if (!resolved.exists) {
    throw new Error(`${SLOT_LABEL[slot]}工作流模板文件不存在：${resolved.path}`)
  }
  let parsed
  try {
    parsed = JSON.parse(fs.readFileSync(resolved.path, 'utf8'))
  } catch (err) {
    throw new Error(`${SLOT_LABEL[slot]}工作流模板无法解析（需要 ComfyUI API 格式 JSON）：${err.message}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${SLOT_LABEL[slot]}工作流模板格式不对：应是「节点 id → {class_type, inputs}」的对象`)
  }
  const nodeIds = Object.keys(parsed)
  if (!nodeIds.length) throw new Error(`${SLOT_LABEL[slot]}工作流模板里没有任何节点`)
  const hasOutput = nodeIds.some((id) => ['SaveImage', 'SaveAnimatedWEBP', 'VHS_VideoCombine'].includes(parsed[id]?.class_type))
  if (!hasOutput) throw new Error(`${SLOT_LABEL[slot]}工作流模板里没有 SaveImage 类输出节点，跑完拿不到图`)
  return { template: parsed, path: resolved.path, source: resolved.source, slot }
}

/** 模板摘要，给面板显示（不打印整份 JSON）。 */
export function describeTemplate(extRoot, slot, customPath) {
  const resolved = templatePath(extRoot, slot, customPath)
  const out = {
    slot,
    label: SLOT_LABEL[slot],
    path: resolved.path,
    source: resolved.source,
    exists: resolved.exists,
    nodes: 0,
    classes: [],
    error: '',
  }
  if (!resolved.path || !resolved.exists) {
    out.error = resolved.path ? '文件不存在' : '未配置'
    return out
  }
  try {
    const tpl = JSON.parse(fs.readFileSync(resolved.path, 'utf8'))
    out.nodes = Object.keys(tpl).length
    out.classes = [...new Set(Object.values(tpl).map((n) => n?.class_type).filter(Boolean))]
  } catch (err) {
    out.error = err.message
  }
  return out
}
