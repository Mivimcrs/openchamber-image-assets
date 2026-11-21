// OpenChamber 扩展服务：面板 serviceRequest 的本机回环后端。
// - 全部请求校验宿主 Bearer（OPENCHAMBER_SERVICE_TOKEN），只监听 127.0.0.1
// - 资产：列表（会话/关键词/标签过滤）、图片字节（base64）、标注、删除
// - 接口：多接口增删改（cloud / local）、每个接口一份密钥（DPAPI 密文，永不下发明文）
// - 模型：云端拉 /models、本地拉 ComfyUI object_info；结果只作补充，不覆盖手填清单
// - 生成：POST /generate 起任务，按接口 kind 路由到云端 API 或本地 ComfyUI
// - 监视索引目录变化，经 createServiceHost().emit 推送面板（host.onServiceEvent）
// 测试经子进程 + 注入环境变量启动；无回调环境时 emit 自动降级为 no-op。

import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createServiceHost } from '@openchamber/sdk'
import {
  ensureLibrary, libraryPaths, scanAssets, findAsset, saveAsset,
  annotateAsset, deleteAsset, filterAssets, insideLibrary, FILE_MB_LIMIT,
} from '../共享/资产库.js'
import { sniffImage } from '../共享/校验.js'
import {
  readSettings, writeSettings, normalizeSettings, upsertInterface, removeInterface,
  resolveInterface, describeInterfaces, normalizeInterface, defaultComfyConfig,
  KIND_LABEL, INTERFACE_KINDS, libraryRoot,
} from '../共享/配置.js'
import {
  resolveApiKey, saveKey, clearStoredKey, maskKey, hasStoredKey, KEY_SOURCE_LABEL, envNameFor,
} from '../共享/密钥.js'
import { migrateIfNeeded } from '../共享/迁移.js'
import { describeModels, capsFor } from '../共享/模型.js'
import { fetchModels, validateSize, MAX_REFERENCES } from '../共享/生成.js'
import { generateWithInterface } from '../共享/统一生成.js'
import { comfyStats, comfyModels, COMFY_ASPECTS } from '../共享/ComfyUI.js'
import { describeTemplate, SLOTS, SLOT_LABEL } from '../共享/工作流.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT_ROOT = path.resolve(HERE, '..')
const ROOT = libraryRoot()
const PORT = Number(process.env.OPENCHAMBER_SERVICE_PORT || 0)
const TOKEN = process.env.OPENCHAMBER_SERVICE_TOKEN || ''
const MAX_BODY = 1024 * 1024
const WATCH_INTERVAL_MS = 2000
const JOB_KEEP = 30

const paths = ensureLibrary(ROOT)

// 启动即做一次 v1 → v2 迁移（幂等：已经是 v2 时什么都不动）
let bootMigration = { migrated: false, warnings: [], backups: {} }
try {
  bootMigration = migrateIfNeeded(ROOT)
} catch (err) {
  bootMigration = { migrated: false, warnings: [`迁移失败：${err?.message || err}`], backups: {} }
}

let serviceHost = null
try {
  serviceHost = createServiceHost({ env: process.env })
} catch {
  serviceHost = null // 测试或缺少回调环境：不推送，接口照常
}

// ---- 工具 ----

function json(res, status, obj) {
  const body = JSON.stringify(obj)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(body)
}

function bearerOk(header) {
  if (!TOKEN) return false
  const expected = crypto.createHash('sha256').update(`Bearer ${TOKEN}`).digest()
  const given = crypto.createHash('sha256').update(String(header || '')).digest()
  return crypto.timingSafeEqual(expected, given)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function readJson(req) {
  const raw = await readBody(req)
  if (!raw.length) return {}
  try {
    return JSON.parse(raw.toString('utf8'))
  } catch {
    throw new Error('body 不是合法 JSON')
  }
}

function mimeFor(file) {
  return file.endsWith('.png') ? 'image/png' : file.endsWith('.jpg') || file.endsWith('.jpeg') ? 'image/jpeg' : 'application/octet-stream'
}

function indexSignature() {
  try {
    const names = fs.readdirSync(paths.index)
    let sig = String(names.length)
    for (const n of names) {
      const st = fs.statSync(path.join(paths.index, n))
      sig += `|${n}:${st.mtimeMs}:${st.size}`
    }
    return sig
  } catch {
    return 'unreadable'
  }
}

async function emit(topic, data) {
  if (!serviceHost) return
  try {
    await serviceHost.emit(topic, { at: Date.now(), ...data })
  } catch { /* 推送失败不影响接口 */ }
}

const emitChange = (detail) => emit('assets-changed', detail)

// ---- 配置视图（脱敏）----

/** 单个接口的密钥状态（不含明文）。 */
function keyView(iface) {
  const resolved = resolveApiKey(ROOT, iface)
  return {
    hasKey: Boolean(resolved.key),
    masked: resolved.key ? maskKey(resolved.key) : '',
    source: resolved.source,
    sourceLabel: KEY_SOURCE_LABEL[resolved.source] || resolved.source,
    stored: hasStoredKey(ROOT, iface.id),
    envName: envNameFor(iface.id),
    error: resolved.error || '',
    warning: resolved.warning || '',
  }
}

function templateViews(iface) {
  if (!iface || iface.kind !== 'local') return []
  return SLOTS.map((slot) => describeTemplate(EXT_ROOT, slot, iface.comfy?.workflows?.[slot]))
}

function configView() {
  const settings = readSettings(ROOT)
  const list = describeInterfaces(settings).map((it) => {
    const iface = settings.interfaces.find((x) => x.id === it.id) || it
    return {
      ...it,
      key: keyView(settings.interfaces.find((x) => x.id === it.id)),
      comfy: iface.kind === 'local' ? iface.comfy : undefined,
      templates: templateViews(iface),
    }
  })
  return {
    settings: {
      ...settings,
      interfaces: undefined, // 接口在下面单独的字段里，避免两套结构
    },
    interfaces: list,
    defaultInterface: settings.defaultInterface,
    kinds: INTERFACE_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] })),
    comfyAspects: COMFY_ASPECTS.map((a) => ({ label: a.label, value: a.value })),
    workflowSlots: SLOTS.map((s) => ({ value: s, label: SLOT_LABEL[s] })),
    migration: bootMigration.migrated
      ? { ran: true, warnings: bootMigration.warnings, backups: bootMigration.backups }
      : (bootMigration.warnings?.length ? { ran: false, warnings: bootMigration.warnings, backups: bootMigration.backups } : null),
    root: ROOT,
  }
}

// ---- 生成任务 ----

const jobs = new Map()

function newJobId() {
  return crypto.randomBytes(6).toString('hex')
}

function pruneJobs() {
  while (jobs.size > JOB_KEEP) {
    const oldest = [...jobs.values()].sort((a, b) => a.startedAt - b.startedAt)[0]
    if (!oldest) break
    jobs.delete(oldest.id)
  }
}

function readReference(id) {
  const rec = findAsset(ROOT, id)
  if (!rec) throw new Error(`参考图资产不存在：${id}`)
  const abs = insideLibrary(ROOT, rec.file)
  if (!abs) throw new Error('参考图路径越界')
  const bytes = fs.readFileSync(abs)
  return { bytes, name: path.basename(rec.file), mime: mimeFor(rec.file), id: rec.id, file: rec.file }
}

async function runJob(job, input) {
  const settings = readSettings(ROOT)
  const step = async (phase, pct) => {
    job.phase = phase
    job.pct = pct
    await emit('generate-progress', { jobId: job.id, phase, pct })
  }

  try {
    const wanted = typeof input.interfaceId === 'string' ? input.interfaceId : (typeof input.interface === 'string' ? input.interface : '')
    const picked = resolveInterface(settings, wanted)
    if (!picked.interface) throw new Error(picked.error)
    const iface = picked.interface
    job.interfaceId = iface.id

    const resolved = resolveApiKey(ROOT, iface)
    if (iface.kind === 'cloud' && !resolved.key) throw new Error(resolved.error || '密钥未配置')

    await step('准备参考图…', 5)
    const references = (Array.isArray(input.references) ? input.references : []).slice(0, MAX_REFERENCES)
    const images = references.map((r) => readReference(typeof r === 'string' ? r : r.id))

    const size = validateSize(input.size || settings.defaultSize, settings.defaultSize)
    const model = typeof input.model === 'string' && input.model.trim() ? input.model.trim() : iface.defaultModel
    const count = iface.kind === 'local' ? 1 : Math.min(4, Math.max(1, Number(input.count) || settings.defaultCount || 1))
    const slot = typeof input.slot === 'string' ? input.slot : ''

    await step(iface.kind === 'local' ? '提交本地 ComfyUI（单次，不自动重试）…' : '请求生成（单次，不自动重试）…', 15)
    const out = await generateWithInterface({
      iface,
      apiKey: resolved.key,
      extRoot: EXT_ROOT,
      prompt: input.prompt,
      size,
      count,
      images,
      transparent: Boolean(input.transparent),
      model,
      slot,
    }, (phase) => { void step(phase, 45) })

    await step('校验并入库…', 85)
    const saved = []
    for (const result of out.results) {
      const info = sniffImage(result.bytes)
      if (!info) throw new Error('返回的内容不是有效 PNG/JPEG，未入库')
      const record = saveAsset(ROOT, result.bytes, {
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
        referenceIds: images.map((i) => i.id).filter(Boolean),
        usage: out.usage,
        sessionId: input.sessionId || null,
        sessionTitle: input.sessionTitle || null,
        projectDirectory: input.projectDirectory || null,
        tags: Array.isArray(input.tags) ? input.tags : [],
        note: typeof input.note === 'string' ? input.note : '',
      })
      saved.push({ id: record.id, file: record.file, width: info.width, height: info.height, bytes: record.bytes })
    }

    job.status = 'done'
    job.pct = 100
    job.phase = '完成'
    job.result = {
      assets: saved,
      warnings: out.warnings,
      usage: out.usage,
      endpoint: out.endpoint,
      model: out.model,
      interfaceId: iface.id,
      interfaceName: iface.name,
    }
    job.finishedAt = Date.now()
    await emit('generate-done', { jobId: job.id, ok: true, assets: saved })
    void emitChange({ reason: 'generate' })
  } catch (err) {
    job.status = 'error'
    job.pct = 100
    job.phase = '失败'
    job.error = String(err?.message || err)
    job.finishedAt = Date.now()
    await emit('generate-done', { jobId: job.id, ok: false, error: job.error })
  }
}

// ---- 路由 ----

const server = http.createServer(async (req, res) => {
  if (!bearerOk(req.headers.authorization)) {
    json(res, 401, { error: 'unauthorized' })
    return
  }
  try {
    const url = new URL(req.url, 'http://127.0.0.1')
    const seg = url.pathname.split('/').filter(Boolean)
    const segDecoded = seg.map((s) => decodeURIComponent(s))

    if (req.method === 'GET' && url.pathname === '/health') {
      json(res, 200, { ok: true })
      return
    }

    // ---- 配置：顶层默认值 ----

    if (req.method === 'GET' && url.pathname === '/config') {
      json(res, 200, configView())
      return
    }

    if (req.method === 'POST' && url.pathname === '/config') {
      let body
      try {
        body = await readJson(req)
      } catch (err) {
        json(res, 400, { error: err.message })
        return
      }
      try {
        const patch = {}
        for (const k of ['defaultInterface', 'defaultSize', 'defaultCount', 'timeoutMs']) {
          if (body[k] !== undefined) patch[k] = body[k]
        }
        if (Object.keys(patch).length) writeSettings(ROOT, patch)
      } catch (err) {
        json(res, 400, { error: String(err?.message || err) })
        return
      }
      void emit('config-changed', { reason: 'settings' })
      json(res, 200, configView())
      return
    }

    if (req.method === 'GET' && url.pathname === '/interfaces') {
      json(res, 200, configView())
      return
    }

    // ---- 配置：接口增改 ----

    if (req.method === 'POST' && url.pathname === '/interfaces') {
      let body
      try {
        body = await readJson(req)
      } catch (err) {
        json(res, 400, { error: err.message })
        return
      }
      const draft = body.interface && typeof body.interface === 'object' ? body.interface : body
      try {
        const settings = upsertInterface(ROOT, draft)
        const savedIface = settings.interfaces.find((it) => it.id === normalizeInterface(draft).id)
          || settings.interfaces.find((it) => it.name === draft.name)
        if (typeof body.apiKey === 'string' && body.apiKey.trim() && savedIface) {
          saveKey(ROOT, savedIface.id, body.apiKey)
        }
        void emit('config-changed', { reason: 'interface-saved' })
        json(res, 200, configView())
      } catch (err) {
        json(res, 400, { error: String(err?.message || err) })
      }
      return
    }

    if (req.method === 'POST' && seg[0] === 'interfaces' && seg.length === 3 && seg[2] === 'delete') {
      try {
        const { removed } = removeInterface(ROOT, segDecoded[1])
        if (hasStoredKey(ROOT, removed.id)) clearStoredKey(ROOT, removed.id)
        void emit('config-changed', { reason: 'interface-deleted' })
        json(res, 200, { ...configView(), removed: removed.id })
      } catch (err) {
        json(res, 400, { error: String(err?.message || err) })
      }
      return
    }

    if (req.method === 'POST' && seg[0] === 'interfaces' && seg.length === 3 && seg[2] === 'default') {
      try {
        const settings = readSettings(ROOT)
        const hit = settings.interfaces.find((it) => it.id === segDecoded[1])
        if (!hit) { json(res, 404, { error: '接口不存在' }); return }
        writeSettings(ROOT, { defaultInterface: hit.id })
        void emit('config-changed', { reason: 'default-interface' })
        json(res, 200, configView())
      } catch (err) {
        json(res, 400, { error: String(err?.message || err) })
      }
      return
    }

    // ---- 配置：接口密钥 ----

    if (req.method === 'POST' && seg[0] === 'interfaces' && seg.length === 3 && seg[2] === 'key') {
      let body
      try {
        body = await readJson(req)
      } catch (err) {
        json(res, 400, { error: err.message })
        return
      }
      const id = segDecoded[1]
      const settings = readSettings(ROOT)
      if (!settings.interfaces.some((it) => it.id === id)) {
        json(res, 404, { error: '接口不存在' })
        return
      }
      try {
        if (body.clear === true) clearStoredKey(ROOT, id)
        else if (typeof body.apiKey === 'string' && body.apiKey.trim()) saveKey(ROOT, id, body.apiKey)
        else { json(res, 400, { error: '缺少 apiKey 或 clear' }); return }
      } catch (err) {
        json(res, 400, { error: String(err?.message || err) })
        return
      }
      void emit('config-changed', { reason: body.clear === true ? 'interface-key-cleared' : 'interface-key-saved' })
      json(res, 200, configView())
      return
    }

    // ---- 兼容旧面板路由：单密钥清除（已无默认接口，只清 legacy） ----
    if (req.method === 'POST' && url.pathname === '/config/key/clear') {
      const settings = readSettings(ROOT)
      let cleared = false
      for (const it of settings.interfaces) {
        if (hasStoredKey(ROOT, it.id)) cleared = clearStoredKey(ROOT, it.id) || cleared
      }
      void emit('config-changed', { reason: 'key-cleared' })
      json(res, 200, { cleared, ...configView() })
      return
    }

    // ---- 接口连通性测试 ----

    if (req.method === 'POST' && seg[0] === 'interfaces' && seg.length === 3 && seg[2] === 'test') {
      let body = {}
      try {
        body = await readJson(req)
      } catch (err) {
        json(res, 400, { error: err.message })
        return
      }
      const id = segDecoded[1]
      const settings = readSettings(ROOT)
      const saved = settings.interfaces.find((it) => it.id === id)
      const draft = saved
        ? normalizeInterface({ ...saved, ...(body.interface || {}) })
        : normalizeInterface({ ...(body.interface || {}), id })
      const key = typeof body.apiKey === 'string' && body.apiKey.trim()
        ? body.apiKey.trim()
        : resolveApiKey(ROOT, saved || draft).key

      try {
        if (draft.kind === 'local') {
          const stats = await comfyStats(draft.baseUrl)
          const models = await comfyModels(draft.baseUrl)
          json(res, 200, { ok: true, kind: 'local', stats, models, hasKey: Boolean(key) })
          return
        }
        if (!key) { json(res, 200, { ok: false, kind: 'cloud', error: '没有可用密钥' }); return }
        const payload = await fetchModels({ baseUrl: draft.baseUrl, apiKey: key })
        const models = describeModels(payload)
        json(res, 200, {
          ok: true,
          kind: 'cloud',
          total: Array.isArray(payload?.data) ? payload.data.length : 0,
          models,
          hasDefault: models.some((m) => m.id === draft.defaultModel),
        })
      } catch (err) {
        json(res, 200, { ok: false, kind: draft.kind, error: String(err?.message || err) })
      }
      return
    }

    // ---- 模型清单（按接口） ----

    if (req.method === 'GET' && url.pathname === '/models') {
      const settings = readSettings(ROOT)
      const id = url.searchParams.get('interface') || ''
      const picked = resolveInterface(settings, id)
      if (!picked.interface) {
        json(res, 200, { ok: false, error: picked.error, models: describeModels(null), manual: [] })
        return
      }
      const iface = picked.interface
      const manual = iface.models || []
      if (iface.kind === 'local') {
        try {
          const m = await comfyModels(iface.baseUrl)
          json(res, 200, {
            ok: true,
            kind: 'local',
            interfaceId: iface.id,
            manual,
            defaultModel: iface.defaultModel,
            local: m,
            models: [
              ...m.unets.map((x) => ({ id: x, known: true, group: '扩散模型', note: '来自 ComfyUI object_info' })),
              ...m.loras.map((x) => ({ id: x, known: false, group: 'LoRA', note: '' })),
              ...m.clips.map((x) => ({ id: x, known: false, group: '文本编码器', note: '' })),
              ...m.vaes.map((x) => ({ id: x, known: false, group: 'VAE', note: '' })),
            ],
            templates: templateViews(iface),
          })
        } catch (err) {
          json(res, 200, {
            ok: false,
            kind: 'local',
            error: String(err?.message || err),
            interfaceId: iface.id,
            manual,
            defaultModel: iface.defaultModel,
            models: manual.map((x) => ({ id: x, known: true, note: '手动填写' })),
            templates: templateViews(iface),
          })
        }
        return
      }
      const key = resolveApiKey(ROOT, iface).key
      if (!key) {
        json(res, 200, {
          ok: false,
          kind: 'cloud',
          error: '没有可用密钥',
          interfaceId: iface.id,
          defaultModel: iface.defaultModel,
          manual,
          models: manual.map((x) => ({ id: x, known: true, note: '手动填写' })),
        })
        return
      }
      try {
        const payload = await fetchModels({ baseUrl: iface.baseUrl, apiKey: key })
        const fetched = describeModels(payload)
        const byId = new Map(fetched.map((m) => [m.id, m]))
        for (const x of manual) if (!byId.has(x)) byId.set(x, { id: x, known: true, note: '手动填写' })
        json(res, 200, {
          ok: true,
          kind: 'cloud',
          interfaceId: iface.id,
          defaultModel: iface.defaultModel,
          manual,
          total: Array.isArray(payload?.data) ? payload.data.length : 0,
          models: [...byId.values()],
        })
      } catch (err) {
        json(res, 200, {
          ok: false,
          kind: 'cloud',
          error: String(err?.message || err),
          interfaceId: iface.id,
          defaultModel: iface.defaultModel,
          manual,
          models: manual.map((x) => ({ id: x, known: true, note: '手动填写' })),
        })
      }
      return
    }

    // ---- 生成任务 ----

    if (req.method === 'POST' && url.pathname === '/generate') {
      let body
      try {
        body = await readJson(req)
      } catch (err) {
        json(res, 400, { error: err.message })
        return
      }
      if (!body || typeof body.prompt !== 'string' || !body.prompt.trim()) {
        json(res, 400, { error: 'prompt 不能为空' })
        return
      }
      const job = {
        id: newJobId(),
        status: 'running',
        phase: '排队',
        pct: 0,
        startedAt: Date.now(),
        prompt: body.prompt.trim(),
      }
      jobs.set(job.id, job)
      pruneJobs()
      void emit('generate-progress', { jobId: job.id, phase: job.phase, pct: 0 })
      void runJob(job, body)
      json(res, 202, { jobId: job.id })
      return
    }

    if (req.method === 'GET' && seg[0] === 'generate' && seg.length === 2) {
      const job = jobs.get(seg[1])
      if (!job) { json(res, 404, { error: '任务不存在或已过期' }); return }
      json(res, 200, job)
      return
    }

    // ---- 模型能力 ----

    if (req.method === 'GET' && seg[0] === 'caps' && seg.length === 2) {
      json(res, 200, capsFor(segDecoded[1]))
      return
    }

    // ---- 资产 ----

    if (req.method === 'GET' && seg[0] === 'assets' && seg.length === 1) {
      const { assets, warnings } = scanAssets(ROOT)
      const filtered = filterAssets(assets, {
        sessionId: url.searchParams.get('sessionId') || undefined,
        q: url.searchParams.get('q') || undefined,
        tag: url.searchParams.get('tag') || undefined,
      })
      json(res, 200, { assets: filtered, total: assets.length, warnings, root: ROOT })
      return
    }

    if (req.method === 'GET' && seg[0] === 'assets' && seg.length === 3 && seg[2] === 'file') {
      const rec = findAsset(ROOT, seg[1])
      if (!rec) { json(res, 404, { error: '资产不存在' }); return }
      const abs = path.join(ROOT, rec.file)
      if (!abs.startsWith(paths.root + path.sep)) { json(res, 400, { error: 'file 越界' }); return }
      let bytes
      try {
        bytes = fs.readFileSync(abs)
      } catch {
        json(res, 404, { error: '图片文件缺失' })
        return
      }
      if (bytes.length > FILE_MB_LIMIT * 1024 * 1024) {
        json(res, 413, { error: `图片 ${(bytes.length / 1048576).toFixed(1)}MB 超过单次回传上限，请打开文件查看：${abs}` })
        return
      }
      const info = sniffImage(bytes)
      json(res, 200, {
        id: rec.id,
        mime: mimeFor(rec.file),
        width: info ? info.width : rec.width,
        height: info ? info.height : rec.height,
        bytes: bytes.length,
        base64: bytes.toString('base64'),
      })
      return
    }

    // 参考图缓存（库内相对路径，只允许 运行时\参考 与 图片）
    if (req.method === 'GET' && url.pathname === '/library-file') {
      const rel = url.searchParams.get('path') || ''
      if (!/^(运行时\\参考\\|图片\\)/.test(rel)) { json(res, 400, { error: '路径不在允许范围' }); return }
      const abs = insideLibrary(ROOT, rel)
      if (!abs) { json(res, 400, { error: '路径越界' }); return }
      let bytes
      try {
        bytes = fs.readFileSync(abs)
      } catch {
        json(res, 404, { error: '文件缺失' })
        return
      }
      if (bytes.length > FILE_MB_LIMIT * 1024 * 1024) {
        json(res, 413, { error: '参考图过大，无法回传' })
        return
      }
      json(res, 200, {
        mime: mimeFor(abs),
        bytes: bytes.length,
        base64: bytes.toString('base64'),
      })
      return
    }

    if (req.method === 'POST' && seg[0] === 'assets' && seg.length === 3 && seg[2] === 'annotate') {
      let body
      try {
        body = await readJson(req)
      } catch (err) {
        json(res, 400, { error: err.message })
        return
      }
      try {
        const asset = annotateAsset(ROOT, seg[1], body)
        void emitChange({ reason: 'annotate', id: asset.id })
        json(res, 200, { asset })
      } catch (err) {
        json(res, 404, { error: err.message })
      }
      return
    }

    if (req.method === 'POST' && seg[0] === 'assets' && seg.length === 3 && seg[2] === 'delete') {
      try {
        const result = deleteAsset(ROOT, seg[1])
        void emitChange({ reason: 'delete', id: seg[1] })
        json(res, 200, result)
      } catch (err) {
        json(res, 404, { error: err.message })
      }
      return
    }

    json(res, 404, { error: 'not found' })
  } catch (err) {
    json(res, 500, { error: String(err?.message || err) })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  const addr = server.address()
  console.log(`[image-assets] service listening on 127.0.0.1:${addr.port}, root=${ROOT}`)
})

// ---- 变更监视：插件直接写盘，这里轮询签名变化后推送 ----

let lastSig = indexSignature()
const timer = setInterval(() => {
  const sig = indexSignature()
  if (sig !== lastSig) {
    lastSig = sig
    void emitChange({ reason: 'scan' })
  }
}, WATCH_INTERVAL_MS)

process.on('SIGTERM', () => {
  clearInterval(timer)
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
})

// 供测试/自检引用（无副作用）
export { EXT_ROOT, defaultComfyConfig }
