// 共享纯逻辑：资产库目录、索引扫描、入库、标注、删除。
// 只依赖 node:fs / node:path；不 import SDK，便于单测。

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export const FILE_MB_LIMIT = 5.5          // serviceRequest 上限 8 000 000 字节，base64 放大 4/3 后留余量
export const NOTE_MAX = 2000
export const TAG_MAX = 30
export const TAG_LEN = 40

export function libraryPaths(root) {
  return {
    root,
    images: path.join(root, '图片'),
    index: path.join(root, '索引'),
    runtime: path.join(root, '运行时'),
    refs: path.join(root, '运行时', '参考'),
    config: path.join(root, '配置'),
  }
}

export function ensureLibrary(root) {
  const p = libraryPaths(root)
  for (const dir of Object.values(p)) fs.mkdirSync(dir, { recursive: true })
  return p
}

/** 扫描索引，返回记录数组（按 createdAt 倒序）；坏记录跳过并收集到 warnings。 */
export function scanAssets(root) {
  const { index, images } = libraryPaths(root)
  const assets = []
  const warnings = []
  let names = []
  try {
    names = fs.readdirSync(index)
  } catch {
    return { assets, warnings }
  }
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const rec = JSON.parse(fs.readFileSync(path.join(index, name), 'utf8'))
      if (!rec || typeof rec.id !== 'string') throw new Error('缺少 id')
      const fileAbs = path.join(root, rec.file || '')
      if (!rec.file || !fileAbs.startsWith(root + path.sep)) throw new Error('file 越界')
      if (!fs.existsSync(fileAbs)) throw new Error('图片文件不存在')
      assets.push(rec)
    } catch (err) {
      warnings.push(`${name}: ${err.message}`)
    }
  }
  assets.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
  return { assets, warnings }
}

export function findAsset(root, id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null
  const { index } = libraryPaths(root)
  try {
    const rec = JSON.parse(fs.readFileSync(path.join(index, id + '.json'), 'utf8'))
    return rec && rec.id === id ? rec : null
  } catch {
    return null
  }
}

/** 生成资产 id：时间戳 + 随机后缀，文件系统安全。 */
export function makeAssetId(now = Date.now(), rand = Math.random()) {
  return now.toString(36) + '-' + Math.floor(rand * 0xffffff).toString(36).padStart(4, '0')
}

/**
 * 入库：写图片文件 → 写索引记录。
 * record 缺 id/file/createdAt/prompt 时补齐；文件名由本函数决定。
 */
export function saveAsset(root, bytes, record) {
  const { images, index } = ensureLibrary(root)
  const ext = bytes[0] === 0x89 ? '.png' : bytes[1] === 0xd8 ? '.jpg' : '.bin'
  const id = record.id || makeAssetId(record.createdAt || Date.now())
  const stamp = new Date(record.createdAt || Date.now())
  const ymd = stamp.getFullYear().toString() +
    String(stamp.getMonth() + 1).padStart(2, '0') +
    String(stamp.getDate()).padStart(2, '0')
  const hms = String(stamp.getHours()).padStart(2, '0') +
    String(stamp.getMinutes()).padStart(2, '0') +
    String(stamp.getSeconds()).padStart(2, '0')
  let n = 0
  let fileAbs
  do {
    const suffix = n === 0 ? '' : `-${n}`
    fileAbs = path.join(images, `${ymd}-${hms}-${id}${suffix}${ext}`)
    n++
  } while (fs.existsSync(fileAbs))

  fs.writeFileSync(fileAbs, bytes)
  const full = {
    version: 1,
    ...record,
    id,
    file: path.relative(root, fileAbs),
    bytes: bytes.length,
    createdAt: record.createdAt || Date.now(),
    tags: normalizeTags(record.tags),
    note: typeof record.note === 'string' ? record.note.slice(0, NOTE_MAX) : '',
  }
  fs.writeFileSync(path.join(index, id + '.json'), JSON.stringify(full, null, 2), 'utf8')
  return full
}

/** 标注：更新标签与备注，返回更新后的记录。 */
export function annotateAsset(root, id, { tags, note }) {
  const rec = findAsset(root, id)
  if (!rec) throw new Error('资产不存在')
  if (tags !== undefined) rec.tags = normalizeTags(tags)
  if (note !== undefined) {
    if (typeof note !== 'string') throw new Error('note 必须是字符串')
    rec.note = note.slice(0, NOTE_MAX)
  }
  rec.updatedAt = Date.now()
  const { index } = libraryPaths(root)
  fs.writeFileSync(path.join(index, id + '.json'), JSON.stringify(rec, null, 2), 'utf8')
  return rec
}

/** 删除：先删索引，再删图片（图片删除失败资产已下架，返回 warning）。 */
export function deleteAsset(root, id) {
  const rec = findAsset(root, id)
  if (!rec) throw new Error('资产不存在')
  const { index } = libraryPaths(root)
  fs.rmSync(path.join(index, id + '.json'), { force: true })
  let warning
  const fileAbs = path.join(root, rec.file)
  try {
    if (fileAbs.startsWith(root + path.sep)) fs.rmSync(fileAbs, { force: true })
    else warning = 'file 路径越界，未删除图片'
  } catch (err) {
    warning = `索引已删除，但图片删除失败：${err.message}`
  }
  return { deleted: true, warning }
}

export function normalizeTags(tags) {
  if (!Array.isArray(tags)) return []
  const out = []
  for (const raw of tags) {
    if (typeof raw !== 'string') continue
    const t = raw.trim().slice(0, TAG_LEN)
    if (t && !out.includes(t)) out.push(t)
    if (out.length >= TAG_MAX) break
  }
  return out
}

/** 资产列表过滤：会话、关键词（prompt/note/标签/文件名）、标签。 */
export function filterAssets(assets, { sessionId, q, tag } = {}) {
  let out = assets
  if (sessionId) out = out.filter((a) => a.sessionId === sessionId)
  if (tag) out = out.filter((a) => Array.isArray(a.tags) && a.tags.includes(tag))
  if (q) {
    const needle = q.toLowerCase()
    out = out.filter((a) =>
      [a.prompt, a.note, a.sessionTitle, a.file, ...(a.tags || [])]
        .some((s) => typeof s === 'string' && s.toLowerCase().includes(needle)))
  }
  return out
}

// ---- 参考图缓存 ----
// 对话里传本地路径时，原图不在资产库里，面板没法显示缩略图。
// 这里按内容哈希把参考图副本存进 运行时\参考\，同一个文件只存一份。

export function sha1Hex(bytes) {
  return crypto.createHash('sha1').update(bytes).digest('hex')
}

/**
 * 缓存一张参考图，返回库内相对路径（如 `运行时\参考\ab12…cd.png`）。
 * 同一内容重复调用不会重复写盘。
 */
export function cacheReference(root, bytes, name = 'ref.png') {
  const { refs } = ensureLibrary(root)
  const hash = sha1Hex(bytes)
  const ext = bytes[0] === 0x89 ? '.png' : bytes[1] === 0xd8 ? '.jpg' : path.extname(String(name) || '').toLowerCase() || '.img'
  const file = path.join(refs, hash.slice(0, 16) + ext)
  if (!fs.existsSync(file)) {
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, bytes)
    fs.renameSync(tmp, file)
  }
  return path.relative(root, file)
}

/** 库内相对路径 → 绝对路径，越界返回 null。 */
export function insideLibrary(root, rel) {
  if (typeof rel !== 'string' || !rel) return null
  const abs = path.resolve(root, rel)
  return abs.startsWith(path.resolve(root) + path.sep) ? abs : null
}

// ---- 整库搬迁 ----
// 库里的 配置/（settings.json + 每接口 DPAPI 密钥）、索引/（记录引用 图片/ 的相对路径）、
// 运行时/ 必须一起走，只搬一半会让接口/密钥/缩略图对不上。
//
// 做法：目标目录先落一个 .搬家中/<时间戳>.json 标记 → 逐个复制（同盘 try rename 每个文件/小目录更快）→
// 校验条目数一致 → 把源库改名为 归档名（不删，符合"先归档不删"）→ 清掉标记。
// 中途失败：标记留着，下次调用会用标记里的源/目标续传（已复制且大小一致的文件跳过）。

const MOVE_MARKER_DIR = '.搬家中'
const MOVE_MARKER = 'move.json'
const LIB_ENTRIES = ['图片', '索引', '配置', '运行时']

function countFiles(dir) {
  let n = 0
  let bytes = 0
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return { files: 0, bytes: 0 } }
  for (const e of entries) {
    if (e.isDirectory()) {
      const sub = countFiles(path.join(dir, e.name))
      n += sub.files
      bytes += sub.bytes
    } else {
      n += 1
      try { bytes += fs.statSync(path.join(dir, e.name)).size } catch { /* 忽略 */ }
    }
  }
  return { files: n, bytes }
}

function copyTree(src, dst, onProgress) {
  const st = fs.statSync(src)
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true })
    for (const e of fs.readdirSync(src, { withFileTypes: true })) {
      copyTree(path.join(src, e.name), path.join(dst, e.name), onProgress)
    }
    return
  }
  if (fs.existsSync(dst) && fs.statSync(dst).size === st.size) {
    onProgress?.('skip', src)
    return
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.copyFileSync(src, dst)
  onProgress?.('copy', src)
}

function readMarker(to) {
  try {
    return JSON.parse(fs.readFileSync(path.join(to, MOVE_MARKER_DIR, MOVE_MARKER), 'utf8'))
  } catch {
    return null
  }
}

function writeMarker(to, doc) {
  const dir = path.join(to, MOVE_MARKER_DIR)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, MOVE_MARKER), JSON.stringify(doc, null, 2), 'utf8')
}

function clearMarker(to) {
  try { fs.rmSync(path.join(to, MOVE_MARKER_DIR), { recursive: true, force: true }) } catch { /* 忽略 */ }
}

/**
 * 整库搬迁。可中断、可续：中断后再调用会用目标里的标记把剩余部分补完。
 * @param {string} from 源库根
 * @param {string} to 目标库根
 * @param {{onProgress?: (text: string) => void, keepSource?: boolean, now?: number}} [opts]
 * @returns {{action: 'moved'|'resumed'|'copied', from: string, to: string, files: number, bytes: number, backup: string, warnings: string[]}}
 */
export function moveLibrary(from, to, opts = {}) {
  const src = path.resolve(from)
  const dst = path.resolve(to)
  if (src === dst) throw new Error('源与目标是同一个目录')
  if (dst.startsWith(src + path.sep)) throw new Error('目标不能放在源库里面')
  if (!fs.existsSync(src)) throw new Error(`源库不存在：${src}`)
  const warnings = []

  // 目标里已经有另一个库：除非是上次中断的续传，否则拒绝覆盖，避免把两份数据混在一起
  const existing = readMarker(dst)
  if (!existing && fs.existsSync(path.join(dst, '索引')) && fs.readdirSync(path.join(dst, '索引')).length) {
    throw new Error(`目标位置已经有资产库（${dst}）：请换一个空目录，或先把那边的库挪走`)
  }

  const stamp = (opts.now ? new Date(opts.now) : new Date()).toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
  const resumed = Boolean(existing && path.resolve(existing.from) === src)
  if (existing && !resumed) {
    throw new Error(`目标位置有未完成的搬迁标记（源 ${existing.from}）：先确认那次搬迁，或换一个目标目录`)
  }
  if (!resumed) writeMarker(dst, { version: 1, from: src, to: dst, startedAt: Date.now() })
  opts.onProgress?.(resumed ? '继续上次未完成的搬迁…' : '开始复制资产库…')

  // 1) 逐个顶层目录复制（每次都重新扫，续传时已复制且大小一致的会跳过）
  for (const name of LIB_ENTRIES) {
    const s = path.join(src, name)
    if (!fs.existsSync(s)) continue
    opts.onProgress?.(`复制 ${name}…`)
    copyTree(s, path.join(dst, name))
  }

  // 2) 校验：顶层目录的文件数与字节数必须一致
  let files = 0
  let bytes = 0
  for (const name of LIB_ENTRIES) {
    const s = path.join(src, name)
    if (!fs.existsSync(s)) continue
    const a = countFiles(s)
    const b = countFiles(path.join(dst, name))
    files += b.files
    bytes += b.bytes
    if (a.files !== b.files || a.bytes !== b.bytes) {
      throw new Error(`搬迁校验失败（${name}）：源 ${a.files} 个文件/${a.bytes}B，目标 ${b.files}/${b.bytes}B。标记已保留，可重试续传`)
    }
  }

  // 3) 源库归档（改名而不是删除；同盘 rename 是原子的）
  let backup = ''
  if (opts.keepSource !== true) {
    const target = `${src}.归档-${stamp}`
    try {
      fs.renameSync(src, target)
      backup = target
    } catch (err) {
      warnings.push(`源库改名失败（${err?.message || err}）：已复制到新位置，源库保持原样，请手动归档`)
    }
  } else {
    backup = src
  }
  clearMarker(dst)
  opts.onProgress?.('搬迁完成')
  return { action: resumed ? 'resumed' : 'moved', from: src, to: dst, files, bytes, backup, warnings }
}

/** 目标位置是否有未完成的搬迁标记（面板启动时用来提示）。 */
export function pendingMove(root) {
  const m = readMarker(path.resolve(root))
  return m && typeof m.from === 'string'
    ? { from: m.from, to: m.to, startedAt: Number(m.startedAt) || 0 }
    : null
}

