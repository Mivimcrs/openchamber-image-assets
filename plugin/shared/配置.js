// 共享纯逻辑：扩展配置 v2（多接口：云端 API / 本地 ComfyUI）。
//
// 配置文件为明文 JSON（不含任何密钥）；每个接口的密钥单独走 密钥.js 的 DPAPI 密文。
// v1（单接口 baseUrl + defaultModel）读入时自动归一化成「一条旧配置接口」，但**不设为默认**：
// 由用户在面板里手动指定默认接口与默认模型。
//
// 只依赖 node:fs / node:path，插件侧与 service 侧共用。

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

export const SETTINGS_VERSION = 2

/** 资产库默认目录名（放在用户主目录下）；可用环境变量 IMAGE_ASSETS_ROOT 覆盖。 */
export const LIBRARY_DIR_NAME = 'openchamber-image-assets'

/**
 * 资产库根目录：环境变量 IMAGE_ASSETS_ROOT 优先，否则 `<用户主目录>/openchamber-image-assets`。
 * 不写死任何机器路径，换一台机器也能用；升级前已在别处的库用环境变量指过去。
 * @param {object} [env]
 * @param {string} [home]
 */
export function libraryRoot(env = process.env, home = os.homedir()) {
  const fromEnv = typeof env?.IMAGE_ASSETS_ROOT === 'string' ? env.IMAGE_ASSETS_ROOT.trim() : ''
  if (fromEnv) return path.resolve(fromEnv)
  return path.join(home, LIBRARY_DIR_NAME)
}

export const INTERFACE_KINDS = ['cloud', 'local']
export const KIND_LABEL = { cloud: '云端 API', local: '本地 ComfyUI' }

export const DEFAULT_COMFY_URL = 'http://127.0.0.1:8188'

export const WORKFLOW_SLOTS = ['t2i', 'i2i', 'video']
export const WORKFLOW_SLOT_LABEL = { t2i: '文生图', i2i: '图生图', video: '视频' }

/** 不带任何默认接口：新装为空列表，用户自己添加。 */
export const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  interfaces: [],
  defaultInterface: '',
  defaultSize: '1024x1536',
  defaultCount: 1,
  timeoutMs: 300000,
}

export const SIZE_RE = /^(\d{3,5})x(\d{3,5})$/i
export const INTERFACE_ID_RE = /^[a-z0-9_-]{1,24}$/

export function configDir(root) {
  return path.join(root, '配置')
}

export function settingsPath(root) {
  return path.join(configDir(root), 'settings.json')
}

/** v2 的密钥目录：每个接口一份 <接口id>.dat。 */
export function keysDir(root) {
  return path.join(configDir(root), '密钥')
}

/** v1 的单文件密钥（迁移时归档）。 */
export function legacyCredentialsPath(root) {
  return path.join(configDir(root), 'credentials.dat')
}

export function archiveDir(root) {
  return path.join(configDir(root), '归档')
}

function clampInt(v, min, max, fallback) {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

function str(v, max) {
  return typeof v === 'string' ? v.trim().slice(0, max) : ''
}

export function normalizeBaseUrl(value) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) throw new Error('API 地址不能为空')
  let url
  try {
    url = new URL(raw)
  } catch {
    throw new Error('API 地址不是合法 URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('API 地址只支持 http / https')
  return raw.replace(/\/+$/, '')
}

export function makeInterfaceId(now = Date.now(), rand = crypto.randomBytes(4).toString('hex')) {
  return `if-${now.toString(36)}${String(rand).slice(0, 4)}`.replace(/[^a-z0-9_-]/gi, '').toLowerCase()
}

/** ComfyUI 本地接口的默认工作流配置。 */
export function defaultComfyConfig(input = {}) {
  const src = input && typeof input === 'object' ? input : {}
  const workflows = {}
  for (const slot of WORKFLOW_SLOTS) {
    const item = src.workflows?.[slot] ?? src[slot]
    workflows[slot] = typeof item === 'string' ? item.trim().slice(0, 200) : ''
  }
  return {
    timeoutMs: clampInt(src.timeoutMs, 30_000, 3_600_000, 900_000),
    pollMs: clampInt(src.pollMs, 500, 10_000, 1500),
    workflows,
    negative: typeof src.negative === 'string' ? src.negative.slice(0, 2000) : '',
    steps: clampInt(src.steps, 1, 150, 25),
    cfg: Number.isFinite(Number(src.cfg)) ? Math.min(30, Math.max(0, Number(src.cfg))) : 2.5,
    sampler: str(src.sampler, 80),
    scheduler: str(src.scheduler, 80),
    // 可选：覆盖模板里的模型名；留空表示用模板自带的值
    clip: str(src.clip, 120),
    vae: str(src.vae, 120),
    lora: str(src.lora, 120),
  }
}

/**
 * 归一化单个接口。非法字段回落到默认值，不抛错（读取路径要容错）。
 * @param {object} input
 * @param {{requireUrl?: boolean}} [opts]
 */
export function normalizeInterface(input, opts = {}) {
  const src = input && typeof input === 'object' ? input : {}
  const kind = INTERFACE_KINDS.includes(src.kind) ? src.kind : 'cloud'
  let id = str(src.id, 24).toLowerCase()
  if (!INTERFACE_ID_RE.test(id)) id = makeInterfaceId()
  let baseUrl = kind === 'local' ? DEFAULT_COMFY_URL : ''
  try {
    if (src.baseUrl) baseUrl = normalizeBaseUrl(src.baseUrl)
  } catch {
    if (opts.requireUrl) throw new Error(`接口「${str(src.name, 60) || id}」的 API 地址不是合法 URL：${src.baseUrl}`)
  }
  const models = Array.isArray(src.models)
    ? [...new Set(src.models.map((m) => str(m, 120)).filter(Boolean))].slice(0, 200)
    : []
  const defaultModel = str(src.defaultModel, 120)
  if (defaultModel && !models.includes(defaultModel)) models.unshift(defaultModel)
  return {
    id,
    name: str(src.name, 60) || (kind === 'local' ? '本地 ComfyUI' : '云端接口'),
    kind,
    baseUrl,
    defaultModel,
    models,
    enabled: src.enabled !== false,
    // 只有本地接口才带 comfy 配置；云端接口不写这段（避免 settings.json 里出现无关字段）
    comfy: kind === 'local' ? defaultComfyConfig(src.comfy || src) : undefined,
  }
}

/** v1 配置 → v2：一条名为「旧配置」的云端接口，defaultInterface 留空。 */
export function migrateV1(input) {
  const src = input && typeof input === 'object' ? input : {}
  let interfaceId = 'legacy'
  const iface = normalizeInterface({
    id: interfaceId,
    name: '旧配置',
    kind: 'cloud',
    baseUrl: src.baseUrl,
    defaultModel: src.defaultModel,
    models: src.defaultModel ? [src.defaultModel] : [],
  })
  return {
    version: SETTINGS_VERSION,
    interfaces: [iface],
    defaultInterface: '',
    defaultSize: SIZE_RE.test(String(src.defaultSize || '').trim()) ? String(src.defaultSize).trim().toLowerCase() : DEFAULT_SETTINGS.defaultSize,
    defaultCount: clampInt(src.defaultCount, 1, 4, DEFAULT_SETTINGS.defaultCount),
    timeoutMs: clampInt(src.timeoutMs, 30_000, 600_000, DEFAULT_SETTINGS.timeoutMs),
  }
}

/** 校验并补全配置；非法字段回落到默认值，不抛错。 */
export function normalizeSettings(input) {
  const src = input && typeof input === 'object' ? input : {}
  const legacyShape = !Array.isArray(src.interfaces) && (src.baseUrl || src.defaultModel)
  if (legacyShape) return migrateV1(src)

  const interfaces = (Array.isArray(src.interfaces) ? src.interfaces : [])
    .map((it) => { try { return normalizeInterface(it) } catch { return null } })
    .filter(Boolean)
  const defaultInterface = interfaces.some((it) => it.id === src.defaultInterface) ? src.defaultInterface : ''

  const out = {
    version: SETTINGS_VERSION,
    interfaces,
    defaultInterface,
    defaultSize: DEFAULT_SETTINGS.defaultSize,
    defaultCount: clampInt(src.defaultCount, 1, 4, DEFAULT_SETTINGS.defaultCount),
    timeoutMs: clampInt(src.timeoutMs, 30_000, 600_000, DEFAULT_SETTINGS.timeoutMs),
  }
  if (typeof src.defaultSize === 'string' && SIZE_RE.test(src.defaultSize.trim())) {
    out.defaultSize = src.defaultSize.trim().toLowerCase()
  }
  return out
}

/** 读取配置：文件不存在 / 坏 JSON / 字段非法都不会抛错。 */
export function readSettings(root) {
  try {
    const raw = fs.readFileSync(settingsPath(root), 'utf8')
    return normalizeSettings(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_SETTINGS, interfaces: [] }
  }
}

function writeAtomic(root, doc) {
  const dir = configDir(root)
  fs.mkdirSync(dir, { recursive: true })
  const target = settingsPath(root)
  const tmp = `${target}.${Math.random().toString(36).slice(2)}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(doc, null, 2), 'utf8')
  fs.renameSync(tmp, target)
}

/** 合并写入顶层配置（默认接口/画幅/张数/超时），返回写入后的完整配置。 */
export function writeSettings(root, patch) {
  const current = readSettings(root)
  const patchObj = { ...(patch && typeof patch === 'object' ? patch : {}) }
  const merged = normalizeSettings({ ...current, ...patchObj })
  writeAtomic(root, merged)
  return merged
}

/** 新增或更新一个接口（按 id 匹配），返回写入后的完整配置。 */
export function upsertInterface(root, input) {
  const current = readSettings(root)
  // 写入路径严格校验 id：非法字符/过长直接报错，不静默清洗（否则用户以为存上了、其实成了另一条接口）
  // 大小写不敏感：这里先原样取，不做截断，避免「超长被截成合法」的假通过
  const rawId = input && typeof input === 'object' && typeof input.id === 'string' ? input.id.trim() : ''
  if (rawId && !INTERFACE_ID_RE.test(rawId.toLowerCase())) {
    throw new Error(`接口 id 非法：「${rawId}」只能用小写字母、数字、- 和 _，最长 24 个字符`)
  }
  const draft = normalizeInterface(input, { requireUrl: true })
  const idx = current.interfaces.findIndex((it) => it.id === draft.id)
  const interfaces = idx >= 0
    ? current.interfaces.map((it, i) => (i === idx ? { ...it, ...draft } : it))
    : [...current.interfaces, draft]
  // 新增接口不会自动成为默认接口：默认接口只能由用户手动指定。
  const next = normalizeSettings({ ...current, interfaces })
  writeAtomic(root, next)
  return next
}

/** 删除接口；若它正好是默认接口，默认接口清空。返回 {settings, removed}。 */
export function removeInterface(root, id) {
  const current = readSettings(root)
  const target = current.interfaces.find((it) => it.id === id)
  if (!target) throw new Error('接口不存在')
  const interfaces = current.interfaces.filter((it) => it.id !== id)
  const next = normalizeSettings({
    ...current,
    interfaces,
    defaultInterface: current.defaultInterface === id ? '' : current.defaultInterface,
  })
  writeAtomic(root, next)
  return { settings: next, removed: target }
}

/**
 * 选接口：显式 id > 默认接口 > 唯一启用的接口。找不到时给出人能看懂的原因。
 * @returns {{interface: object|null, error: string}}
 */
export function resolveInterface(settings, wantedId = '') {
  const list = Array.isArray(settings?.interfaces) ? settings.interfaces : []
  const enabled = list.filter((it) => it.enabled !== false)
  const wanted = typeof wantedId === 'string' ? wantedId.trim() : ''
  if (wanted) {
    const hit = list.find((it) => it.id === wanted)
    if (!hit) {
      return { interface: null, error: `接口不存在：${wanted}（可在面板设置里查看接口列表）` }
    }
    return { interface: hit, error: '' }
  }
  if (settings?.defaultInterface) {
    const hit = list.find((it) => it.id === settings.defaultInterface)
    if (hit) return { interface: hit, error: '' }
    return { interface: null, error: '默认接口已失效，请在面板设置里重新指定默认接口' }
  }
  if (enabled.length === 1) return { interface: enabled[0], error: '' }
  if (!list.length) return { interface: null, error: '还没有配置任何接口：请在面板「设置 → 接口」里添加云端接口或本地 ComfyUI' }
  return { interface: null, error: '没有设定默认接口：请在面板设置里手动指定一个默认接口，或调用时用 interface 指定接口 id' }
}

/** 接口摘要，供工具/面板展示（不含密钥）。 */
export function describeInterfaces(settings) {
  return (settings?.interfaces || []).map((it) => ({
    id: it.id,
    name: it.name,
    kind: it.kind,
    kindLabel: KIND_LABEL[it.kind] || it.kind,
    baseUrl: it.baseUrl,
    defaultModel: it.defaultModel,
    models: it.models,
    enabled: it.enabled,
    isDefault: settings.defaultInterface === it.id,
    workflows: it.kind === 'local' ? it.comfy.workflows : undefined,
  }))
}
