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

