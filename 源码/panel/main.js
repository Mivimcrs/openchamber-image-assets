// 生图资产面板：本次会话 / 全部资产 / 创作 / 设置。
// 数据全部经 host.serviceRequest 走本机扩展服务，面板不直接碰文件系统，也永远拿不到密钥明文。

import { connectHost, HostRequestError } from '@openchamber/sdk'
import { applyHostReady } from '@openchamber/sdk/ui'
import { SIZE_PRESETS, MAX_REFERENCES, MAX_COUNT } from '../共享/生成.js'
import { CAP_LABEL } from '../共享/模型.js'

const host = connectHost()

const KIND_LABEL = { cloud: '云端 API', local: '本地 ComfyUI' }
const SLOT_LABEL = { t2i: '文生图', i2i: '图生图', video: '视频' }
const SLOT_ORDER = ['t2i', 'i2i', 'video']


// 诊断陷阱：未捕获的错误显示在页面顶部（宿主沙箱里看不到 console）
const diag = (msg) => {
  const el = document.getElementById('diag')
  if (el) { el.style.display = 'block'; el.textContent += msg + '\n' }
}
window.addEventListener('error', (e) => diag('ERROR: ' + (e.message || e.type) + (e.filename ? ` @${e.filename}:${e.lineno}` : '')))
window.addEventListener('unhandledrejection', (e) => diag('REJECT: ' + String(e.reason?.message || e.reason)))

const state = {
  session: null,
  tab: 'session',      // session | all | create | settings
  assets: [],
  root: '',
  q: '',
  tag: '',
  selected: null,
  banner: '',

  config: null,        // {settings, interfaces, defaultInterface, migration, root}
  configError: '',
  models: [],          // 按当前接口的模型清单（云端 describeModels / 本地 object_info）
  modelsError: '',
  modelsManual: [],
  modelsLocal: null,
  testResult: null,
  saving: false,

  // 接口编辑草稿（设置页）
  ifaceDraft: null,    // 正在编辑/新增的接口对象
  ifaceEditing: false,

  draft: {
    refs: [],          // [{id, name}]
    prompt: '',
    size: '1024x1536',
    count: 1,
    model: '',
    interfaceId: '',   // 创作页选中的接口（空 = 跟随默认接口）
    transparent: false,
  },
  job: null,           // {id, status, phase, pct, error, result}
  generating: false,
}


const imgCache = new Map()   // assetId -> dataURL（LRU，上限 80）
const refCache = new Map()   // 库内相对路径 -> dataURL（参考图副本）
const loading = new Set()

// ---- 基础工具 ----

const $ = (sel) => document.querySelector(sel)
const $$ = (sel) => [...document.querySelectorAll(sel)]

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function fmtTime(ms) {
  try { return new Date(ms).toLocaleString() } catch { return String(ms) }
}

function fmtSize(bytes) {
  if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' MB'
  if (bytes > 1024) return Math.round(bytes / 1024) + ' KB'
  return bytes + ' B'
}

function fmtUsage(usage) {
  if (!usage || typeof usage !== 'object') return ''
  const total = usage.total_tokens
  const img = usage.output_tokens_details?.image_tokens ?? usage.completion_tokens_details?.image_tokens
  const txt = usage.prompt_tokens_details?.text_tokens
  const parts = []
  if (Number.isFinite(total)) parts.push(`${total} tokens`)
  const detail = []
  if (Number.isFinite(img)) detail.push(`图 ${img}`)
  if (Number.isFinite(txt)) detail.push(`文 ${txt}`)
  return parts.concat(detail.length ? [`（${detail.join(' + ')}）`] : []).join('')
}

async function svc(method, path, body) {
  const res = await host.serviceRequest({ method, path, ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}) })
  let parsed = res.body
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) } catch { parsed = { error: parsed.slice(0, 200) } }
  }
  if (res.status < 200 || res.status >= 300) {
    throw new Error(parsed?.error || `HTTP ${res.status}`)
  }
  return parsed
}

function describeHostError(err) {
  if (err instanceof HostRequestError) {
    switch (err.code) {
      case 'NO_SERVICE': return '扩展本地服务未启动或未批准 service 权限（设置 → 扩展 → 生图资产）'
      case 'DISABLED': return '扩展已被停用，请在设置里重新启用'
      case 'SERVICE_FAILED': return '本地服务启动失败'
      case 'REQUEST_FAILED': return '本地服务无响应'
      case 'RESPONSE_TOO_LARGE': return '图片过大，无法回传'
      case 'HOST_TIMEOUT': return '宿主无响应'
      default: return `服务调用失败（${err.code}）`
    }
  }
  return String(err?.message || err)
}

async function toast(kind, message) {
  try { await host.toast({ kind, message, dismiss: true }) } catch { /* 忽略 */ }
}

// ---- 数据 ----

async function refresh() {
  try {
    const data = await svc('GET', '/assets')
    state.assets = data.assets || []
    state.root = data.root || state.root
    state.banner = ''
  } catch (err) {
    state.banner = describeHostError(err)
  }
  render()
}

async function loadConfig() {
  try {
    state.config = await svc('GET', '/config')
    state.configError = ''
    const s = state.config.settings || {}
    if (!state.draft.model) state.draft.model = activeInterface()?.defaultModel || ''
    if (!state.draft.size) state.draft.size = s.defaultSize || '1024x1536'
    if (!state.draft.count) state.draft.count = s.defaultCount || 1
  } catch (err) {
    state.configError = describeHostError(err)
  }
}

/** 设置页/创作页共用的接口列表。 */
function interfaces() {
  return Array.isArray(state.config?.interfaces) ? state.config.interfaces : []
}

function defaultInterface() {
  const id = state.config?.defaultInterface || ''
  return interfaces().find((it) => it.id === id) || null
}

/** 创作页当前实际会用的接口：草稿里显式选的 > 面板默认接口 > 唯一接口。 */
function activeInterface() {
  const list = interfaces()
  const wanted = state.draft.interfaceId
  if (wanted) {
    const hit = list.find((it) => it.id === wanted)
    if (hit) return hit
  }
  const def = defaultInterface()
  if (def) return def
  const enabled = list.filter((it) => it.enabled !== false)
  return enabled.length === 1 ? enabled[0] : null
}

function interfaceLabel(it) {
  if (!it) return '（未设定接口）'
  return `${it.name}（${KIND_LABEL[it.kind] || it.kind}）${it.isDefault ? ' ★' : ''}`
}

async function loadModels(interfaceId) {
  const wanted = interfaceId !== undefined
    ? interfaceId
    : (activeInterface()?.id || state.config?.defaultInterface || '')
  try {
    const qs = wanted ? `?interface=${encodeURIComponent(wanted)}` : ''
    const data = await svc('GET', `/models${qs}`)
    state.models = data.models || []
    state.modelsManual = data.manual || []
    state.modelsLocal = data.local || null
    state.modelsError = data.ok ? '' : (data.error || '')
    const iface = interfaces().find((it) => it.id === data.interfaceId)
    if (!state.draft.model) state.draft.model = (iface?.defaultModel || data.defaultModel || '')
  } catch (err) {
    state.modelsError = describeHostError(err)
  }
}


async function pushAnnotate(id, patch) {
  try {
    const data = await svc('POST', `/assets/${id}/annotate`, patch)
    const i = state.assets.findIndex((a) => a.id === id)
    if (i >= 0) state.assets[i] = data.asset
    state.banner = ''
    render()
    if (state.selected === id) renderDetail()
    await toast('success', '标注已保存')
  } catch (err) {
    await toast('error', '保存失败：' + describeHostError(err))
  }
}

async function doDelete(id) {
  try {
    await svc('POST', `/assets/${id}/delete`)
    state.assets = state.assets.filter((a) => a.id !== id)
    if (state.selected === id) closeDetail()
    render()
    await toast('success', '已删除')
  } catch (err) {
    await toast('error', '删除失败：' + describeHostError(err))
  }
}

// ---- 图片加载（懒加载 + LRU 缓存）----

const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue
    const id = e.target.dataset.id
    if (id && !imgCache.has(id) && !loading.has(id)) void loadImg(id)
  }
}, { rootMargin: '200px' })

async function loadImg(id) {
  loading.add(id)
  try {
    const data = await svc('GET', `/assets/${id}/file`)
    const url = `data:${data.mime};base64,${data.base64}`
    imgCache.set(id, url)
    if (imgCache.size > 80) imgCache.delete(imgCache.keys().next().value)
    document.querySelectorAll(`img[data-id="${CSS.escape(id)}"]`).forEach((img) => { img.src = url })
    if (state.selected === id) {
      const big = document.querySelector('#detail img.big')
      if (big) big.src = url
    }
  } catch (err) {
    const cap = document.querySelector(`figcaption[data-err="${CSS.escape(id)}"]`)
    if (cap) cap.textContent = '取图失败：' + describeHostError(err)
  } finally {
    loading.delete(id)
  }
}

async function loadRefImage(rel) {
  if (refCache.has(rel)) return refCache.get(rel)
  try {
    const data = await svc('GET', `/library-file?path=${encodeURIComponent(rel)}`)
    const url = `data:${data.mime};base64,${data.base64}`
    refCache.set(rel, url)
    document.querySelectorAll(`img[data-ref="${CSS.escape(rel)}"]`).forEach((img) => { img.src = url })
    return url
  } catch {
    return ''
  }
}

function imgSrc(id) { return imgCache.get(id) || '' }

// ---- 草稿持久化 ----

async function saveDraft() {
  try {
    await host.storage.set('draft', JSON.parse(JSON.stringify(state.draft)))
  } catch { /* 忽略 */ }
}

async function loadDraft() {
  try {
    const d = await host.storage.get('draft')
    if (d && typeof d === 'object') {
      state.draft = {
        refs: Array.isArray(d.refs) ? d.refs.filter((r) => r && typeof r.id === 'string').slice(0, MAX_REFERENCES) : [],
        prompt: typeof d.prompt === 'string' ? d.prompt : '',
        size: typeof d.size === 'string' ? d.size : '1024x1536',
        count: Number(d.count) >= 1 && Number(d.count) <= MAX_COUNT ? Number(d.count) : 1,
        model: typeof d.model === 'string' ? d.model : '',
        interfaceId: typeof d.interfaceId === 'string' ? d.interfaceId : '',
        transparent: d.transparent === true,
      }
    }
  } catch { /* 忽略 */ }
}

// ---- 渲染：外壳 ----

function visibleAssets() {
  let list = state.assets
  if (state.tab === 'session') {
    const sid = state.session?.id || null
    list = sid ? list.filter((a) => a.sessionId === sid) : []
  }
  if (state.tag) list = list.filter((a) => (a.tags || []).includes(state.tag))
  if (state.q) {
    const needle = state.q.toLowerCase()
    list = list.filter((a) =>
      [a.prompt, a.note, a.sessionTitle, a.file, ...(a.tags || [])]
        .some((s) => typeof s === 'string' && s.toLowerCase().includes(needle)))
  }
  return list
}

function render() {
  $$('.tab').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tab === state.tab)))

  const banner = $('#banner')
  if (state.banner) {
    banner.hidden = false
    $('#banner-text').textContent = state.banner
  } else {
    banner.hidden = true
  }

  const isList = state.tab === 'session' || state.tab === 'all'
  $('#toolbar').hidden = !isList

  if (!isList) {
    $('#count').textContent = ''
    if (state.tab === 'create') renderCreate()
    else renderSettings()
    return
  }

  const list = visibleAssets()
  $('#count').textContent = state.tab === 'session'
    ? `${list.length} 张`
    : `${list.length} / ${state.assets.length} 张`

  const tags = [...new Set(state.assets.flatMap((a) => a.tags || []))].sort((a, b) => a.localeCompare(b, 'zh'))
  $('#tagrow').innerHTML = tags.length
    ? tags.map((t) =>
        `<button class="tagchip" type="button" data-tag="${esc(t)}" aria-pressed="${state.tag === t}">${esc(t)}</button>`).join('')
    : ''

  const view = $('#view')
  if (state.tab === 'session' && !state.session) {
    view.innerHTML = '<div class="empty">当前没有打开的会话</div>'
    return
  }
  if (!list.length) {
    view.innerHTML = `<div class="empty">${
      state.banner ? '暂时无法列出资产' :
      state.q || state.tag ? '没有匹配的资产' :
      state.tab === 'session' ? '本次会话还没有生成图片' : '资产库还是空的'
    }</div>`
    return
  }

  view.innerHTML = `<div class="grid">${list.map((a) => {
    const ratio = a.width && a.height ? `aspect-ratio:${a.width}/${a.height}` : 'aspect-ratio:3/4'
    const src = imgSrc(a.id)
    const refs = Array.isArray(a.references) ? a.references.length
      : Array.isArray(a.referenceIds) ? a.referenceIds.length : 0
    return `<figure class="tile" data-id="${esc(a.id)}" style="margin:0">
      ${src
        ? `<img data-id="${esc(a.id)}" src="${src}" alt="${esc(a.prompt || '').slice(0, 60)}" />`
        : `<span class="ph" style="${ratio}"></span>
           <img data-id="${esc(a.id)}" src="" alt="" hidden />`}
      <div class="marks">${refs ? `<span class="mark">🖼${refs}</span>` : ''}</div>
      ${a.format === 'png' && a.alpha ? '<span class="alpha" title="PNG（可能含透明通道）"></span>' : ''}
      <figcaption data-err="${esc(a.id)}">${esc(fmtTime(a.createdAt))}${a.tags?.length ? ' · ' + esc(a.tags[0]) : ''}</figcaption>
    </figure>`
  }).join('')}</div>`

  view.querySelectorAll('figure.tile').forEach((fig) => {
    io.observe(fig)
    fig.addEventListener('click', () => openDetail(fig.dataset.id))
  })
  view.querySelectorAll('img[data-id]').forEach((img) => {
    const url = imgCache.get(img.dataset.id)
    if (url) { img.src = url; img.hidden = false }
  })
}

// ---- 渲染：创作 ----

function refThumb(ref) {
  const src = imgSrc(ref.id)
  return `<button class="slot" type="button" data-ref-id="${esc(ref.id)}" title="${esc(ref.name || '')}">
    ${src ? `<img src="${src}" alt="" />` : ''}
    <span class="x" data-remove-ref="${esc(ref.id)}">×</span>
  </button>`
}

function renderCreate() {
  const d = state.draft
  const iface = activeInterface()
  const isLocal = iface?.kind === 'local'
  const presets = SIZE_PRESETS.map((p) =>
    `<button type="button" data-size="${esc(p.size)}" aria-pressed="${d.size === p.size}">${esc(p.label)}</button>`).join('')

  const ifaceOptions = interfaces().length
    ? [`<option value="">跟随默认接口${defaultInterface() ? `（${esc(defaultInterface().name)}）` : '（未设定）'}</option>`,
       ...interfaces().map((it) => `<option value="${esc(it.id)}" ${d.interfaceId === it.id ? 'selected' : ''} ${it.enabled === false ? 'disabled' : ''}>${esc(interfaceLabel(it))}</option>`)].join('')
    : '<option value="">（还没有接口，请到设置页添加）</option>'

  const modelList = isLocal
    ? (iface?.defaultModel ? [iface.defaultModel, ...(state.modelsManual || [])] : (state.modelsManual || [])).filter((v, i, a) => v && a.indexOf(v) === i)
    : (state.models.length ? state.models.map((m) => m.id) : (state.modelsManual || []))
  const currentModel = d.model || iface?.defaultModel || ''
  const modelOptions = modelList.length
    ? modelList.map((id) => `<option value="${esc(id)}" ${id === currentModel ? 'selected' : ''}>${esc(id)}</option>`).join('')
    : `<option value="${esc(currentModel)}">${esc(currentModel || (isLocal ? '（本地模型由工作流模板决定）' : '（先配置模型）'))}</option>`
  const caps = state.models.find((m) => m.id === currentModel)
  const job = state.job
  const results = job?.result?.assets || []

  $('#view').innerHTML = `<div class="form">
    <div class="group">
      <div class="ghead"><span class="gname">接口</span>
        <span class="hint">${iface ? esc(KIND_LABEL[iface.kind] || iface.kind) : '未设定'}</span></div>
      <select class="input" id="c-iface">${ifaceOptions}</select>
      ${iface ? `<div class="hint">${esc(iface.baseUrl)}${isLocal ? ` · 工作流：${esc(SLOT_LABEL[d.refs.length ? 'i2i' : 't2i'])}` : ''}${iface.key?.hasKey || isLocal ? '' : ' · 密钥未配置'}</div>` : ''}
      ${isLocal ? '<div class="hint">本地 ComfyUI：MOSS 图生图是把参考图交给提示词扩写后重新生成，不是像素级重绘。</div>' : ''}
    </div>

    <div class="group">
      <div class="ghead"><span class="gname">参考图</span><span class="hint">${d.refs.length}/${MAX_REFERENCES}</span></div>
      <div class="refslots">
        ${d.refs.map(refThumb).join('')}
        ${d.refs.length < MAX_REFERENCES ? '<button class="slot add" type="button" data-act="pick-ref">+</button>' : ''}
      </div>
      <div class="hint">从资产库选图引用；不选就是文生图。</div>
    </div>

    <div class="group">
      <div class="ghead"><span class="gname">提示词</span></div>
      <textarea class="textarea" id="c-prompt" rows="5" placeholder="写清「保留什么、只改什么」。例：人物动作与器械不变，背景换成摄影棚浅灰无缝纸，柔光箱主光。">${esc(d.prompt)}</textarea>
    </div>

    <div class="group">
      <div class="ghead"><span class="gname">画幅</span><span class="hint">${isLocal ? '本地按最接近的画幅比 + 总像素换算' : '接口不严格校验，模型可能自行调整'}</span></div>
      <div class="seg">${presets}</div>
      <input class="input" id="c-size" value="${esc(d.size)}" placeholder="或自定义 1024x1536" />
    </div>

    <div class="group">
      <div class="line"><span class="k">张数</span>
        <div class="v seg">${[1, 2, 3, 4].map((n) =>
          `<button type="button" data-count="${n}" aria-pressed="${d.count === n}" ${isLocal ? 'disabled' : ''}>${n}</button>`).join('')}</div>
      </div>
      <div class="line"><span class="k">模型</span><div class="v"><select class="input" id="c-model">${modelOptions}</select></div></div>
      ${state.modelsError ? `<div class="hint">模型清单：${esc(state.modelsError)}</div>` : ''}
      ${caps ? `<div class="caps">${capBadges(caps)}</div><div class="hint">${esc(caps.note || '')}</div>` : ''}
      <div class="line"><span class="k">透明底</span><div class="v hint">${d.refs.length ? '参考图模式下不可用（未验证）' : (isLocal ? '本地模板未验证透明输出' : '仅在云端文生图验证过；PNG')}</div>
        <button class="switch" type="button" data-act="toggle-transparent" aria-pressed="${d.transparent && !d.refs.length && !isLocal}" ${(d.refs.length || isLocal) ? 'disabled' : ''}><i></i></button>
      </div>
    </div>

    <button class="btn primary" type="button" data-act="generate" ${state.generating || !iface ? 'disabled' : ''}>
      ${state.generating ? '生成中…' : (isLocal ? '本地生成' : '生成')}
    </button>
    <div class="hint" style="text-align:center">单次请求，失败不自动重试；${isLocal ? '本地约 1–3 分钟（看显存）' : '云端一次约 25–40 秒'}。</div>

    ${state.generating || job ? `<div class="group">
      <div class="line"><span class="k">${job?.status === 'error' ? '失败' : job?.status === 'done' ? '完成' : '进度'}</span>
        <div class="v"><div class="prog"><i style="width:${Number(job?.pct) || 0}%"></i></div></div>
      </div>
      <div class="hint">${esc(job?.phase || '')}</div>
      ${job?.error ? `<div class="bad" style="white-space:pre-wrap">${esc(job.error)}</div>` : ''}
      ${job?.result?.warnings?.length ? `<div class="hint">提示：${esc(job.result.warnings.join('；'))}</div>` : ''}
      ${results.length ? `<div class="result">${results.map((a) =>
        `<button type="button" data-open-asset="${esc(a.id)}"><img data-id="${esc(a.id)}" src="${imgSrc(a.id)}" alt="" /></button>`).join('')}</div>` : ''}
    </div>` : ''}
  </div>`

  // 事件
  const view = $('#view')
  view.querySelector('#c-prompt')?.addEventListener('input', (e) => { state.draft.prompt = e.target.value; void saveDraft() })
  view.querySelector('#c-size')?.addEventListener('change', (e) => {
    state.draft.size = e.target.value.trim().toLowerCase()
    void saveDraft()
  })
  view.querySelector('#c-iface')?.addEventListener('change', (e) => {
    state.draft.interfaceId = e.target.value
    state.draft.model = ''
    void saveDraft()
    void loadModels(state.draft.interfaceId).then(() => renderCreate())
  })
  view.querySelector('#c-model')?.addEventListener('change', (e) => { state.draft.model = e.target.value; void saveDraft(); renderCreate() })
  view.querySelectorAll('[data-size]').forEach((b) => b.addEventListener('click', () => {
    state.draft.size = b.dataset.size
    void saveDraft(); renderCreate()
  }))
  view.querySelectorAll('[data-count]').forEach((b) => b.addEventListener('click', () => {
    if (isLocal) return
    state.draft.count = Number(b.dataset.count)
    void saveDraft(); renderCreate()
  }))
  view.querySelector('[data-act="toggle-transparent"]')?.addEventListener('click', (e) => {
    if (state.draft.refs.length || isLocal) return
    state.draft.transparent = !state.draft.transparent
    e.currentTarget.setAttribute('aria-pressed', String(state.draft.transparent))
    void saveDraft()
  })
  view.querySelector('[data-act="generate"]')?.addEventListener('click', () => void startGenerate())
  view.querySelectorAll('[data-act="pick-ref"]').forEach((b) => b.addEventListener('click', openPicker))
  view.querySelectorAll('[data-remove-ref]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation()
    state.draft.refs = state.draft.refs.filter((r) => r.id !== b.dataset.removeRef)
    void saveDraft(); renderCreate()
  }))
  view.querySelectorAll('[data-open-asset]').forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.openAsset)))
  view.querySelectorAll('img[data-id]').forEach((img) => {
    const url = imgCache.get(img.dataset.id)
    if (url) img.src = url
  })
}


// ---- 渲染：设置 ----

function capBadges(m) {
  return Object.entries(CAP_LABEL).map(([k, label]) => {
    const v = m[k]
    const cls = v === true ? 'cap y' : v === false ? 'cap q' : 'cap'
    return `<span class="${cls}">${esc(label)}${v === false ? ' ✕' : v === true ? '' : ' ?'}</span>`
  }).join('')
}

/** 新增接口时的空草稿。 */
function blankInterface(kind = 'cloud') {
  return {
    id: '',
    name: kind === 'local' ? '本地 ComfyUI' : '新的云端接口',
    kind,
    baseUrl: kind === 'local' ? 'http://127.0.0.1:8188' : '',
    defaultModel: '',
    models: [],
    enabled: true,
    comfy: {
      timeoutMs: 900000, pollMs: 1500, workflows: { t2i: '', i2i: '', video: '' },
      negative: '', steps: 25, cfg: 2.5, sampler: '', scheduler: '', clip: '', vae: '', lora: '',
    },
  }
}

function ifaceCard(it, draft) {
  const k = it.key || {}
  const isLocal = it.kind === 'local'
  return `<div class="group" data-iface="${esc(it.id)}">
    <div class="ghead">
      <span class="gname">${esc(it.name)}${it.isDefault ? ' <span class="cap y">默认</span>' : ''}
        <span class="cap">${esc(KIND_LABEL[it.kind] || it.kind)}</span>
        ${it.enabled === false ? '<span class="cap q">已停用</span>' : ''}</span>
      <span class="hint">${esc(it.id)}</span>
    </div>
    <div class="hint" style="font-family:var(--font-mono);font-size:10.5px">${esc(it.baseUrl || '(未填地址)')}</div>
    <div class="hint">${isLocal ? '本地工作流' : `默认模型：${esc(it.defaultModel || '(未设)')}`}${
      isLocal ? ` · ${(it.templates || []).map((t) => `${esc(t.label)} ${t.exists ? '✓' : '✗'}`).join(' · ')}` : ''
    }</div>
    <div class="hint">密钥：${isLocal
      ? (k.hasKey ? `可选密钥 ${esc(k.masked)}` : '不需要（本地接口）')
      : (k.hasKey ? `${esc(k.masked)}（${esc(k.sourceLabel || '')}）` : `未配置（可用环境变量 ${esc(k.envName || '')}）`)}</div>
    <div class="row">
      <button class="btn" type="button" data-act="iface-edit" data-id="${esc(it.id)}">编辑</button>
      <button class="btn" type="button" data-act="iface-test" data-id="${esc(it.id)}">测试连接</button>
      ${it.isDefault
        ? `<button class="btn" type="button" disabled>已是默认</button>`
        : `<button class="btn primary" type="button" data-act="iface-default" data-id="${esc(it.id)}">设为默认接口</button>`}
      <button class="btn danger" type="button" data-act="iface-del" data-id="${esc(it.id)}">删除</button>
    </div>
    ${draft ? renderIfaceEditor(draft) : ''}
  </div>`
}

function renderIfaceEditor(it) {
  const isLocal = it.kind === 'local'
  const comfy = it.comfy || blankInterface('local').comfy
  const manualModels = (it.models || []).join('\n')
  // 新增接口时还没有模板摘要：用默认的槽位占位，用户可直接填自定义路径
  const tpl = (Array.isArray(it.templates) && it.templates.length ? it.templates : SLOT_ORDER.map((slot) => ({
    slot, label: SLOT_LABEL[slot], path: '', source: 'none', exists: false, nodes: 0, error: '未配置',
  })))
  const local = state.modelsLocal
  return `<div class="iface-edit" data-edit-for="${esc(it.id)}">
    <div class="line"><span class="k">类型</span><div class="v seg">
      ${['cloud', 'local'].map((k) => `<button type="button" data-edit-kind="${k}" aria-pressed="${it.kind === k}">${esc(KIND_LABEL[k])}</button>`).join('')}
    </div></div>
    <div class="line"><span class="k">名称</span><div class="v"><input class="input" id="e-name" value="${esc(it.name)}" /></div></div>
    <div class="line"><span class="k">地址</span><div class="v"><input class="input" id="e-baseurl" value="${esc(it.baseUrl)}" placeholder="${isLocal ? 'http://127.0.0.1:8188' : 'https://api.example.com/v1'}" /></div></div>
    <div class="line"><span class="k">默认模型</span><div class="v"><input class="input" id="e-model" value="${esc(it.defaultModel)}" placeholder="${isLocal ? 'moss_image_sft_int8_convrot.safetensors' : 'gpt-image-2.6-sunburst'}" /></div></div>
    <div class="ghead"><span class="gname">模型清单（手动填写，一行一个）</span>
      <span class="hint">拉取到的模型只作补充，不覆盖手填</span></div>
    <textarea class="textarea" id="e-models" rows="3" placeholder="一行一个模型 id">${esc(manualModels)}</textarea>
    ${isLocal ? `
      <div class="ghead"><span class="gname">ComfyUI 工作流</span>
        <span class="hint">留空 = 用扩展自带的 工作流/ 模板</span></div>
      ${tpl.map((t) => `<div class="line"><span class="k">${esc(t.label)}</span><div class="v">
        <input class="input" id="e-wf-${esc(t.slot)}" value="${esc(it.comfy?.workflows?.[t.slot] || '')}" placeholder="${esc(t.exists ? t.path : '（未配置）')}" />
        <div class="hint">${t.exists ? `当前：${esc(t.path)}（${t.nodes} 个节点）` : (t.error ? esc(t.error) : '')}</div>
      </div></div>`).join('')}
      <div class="line"><span class="k">超时(s)</span><div class="v"><input class="input" id="e-timeout" value="${esc(Math.round((comfy.timeoutMs || 900000) / 1000))}" /></div></div>
      <div class="line"><span class="k">步数 / CFG</span><div class="v" style="display:flex;gap:6px">
        <input class="input" id="e-steps" value="${esc(comfy.steps ?? 25)}" />
        <input class="input" id="e-cfg" value="${esc(comfy.cfg ?? 2.5)}" />
      </div></div>
      <div class="line"><span class="k">采样器 / 调度器</span><div class="v" style="display:flex;gap:6px">
        <input class="input" id="e-sampler" value="${esc(comfy.sampler || '')}" placeholder="er_sde（留空用模板值）" />
        <input class="input" id="e-scheduler" value="${esc(comfy.scheduler || '')}" placeholder="simple（留空用模板值）" />
      </div></div>
      <div class="line"><span class="k">反向提示词</span><div class="v"><input class="input" id="e-negative" value="${esc(comfy.negative || '')}" placeholder="留空用模板值" /></div></div>
      ${local ? `<div class="hint">ComfyUI 里的扩散模型：${esc(local.unets.slice(0, 4).join('、') || '(未拉取)')}</div>` : ''}
    ` : ''}
    <div class="line"><span class="k">启用</span><div class="v hint">停用后不参与生成（仍保留配置）</div>
      <button class="switch" type="button" data-edit-toggle-enabled aria-pressed="${it.enabled !== false}"><i></i></button>
    </div>
    <div class="row">
      <button class="btn primary" type="button" data-act="iface-save" data-id="${esc(it.id)}">保存接口</button>
      <button class="btn" type="button" data-act="iface-cancel">取消</button>
      ${isLocal ? '' : '<button class="btn" type="button" data-act="iface-pull" data-id="' + esc(it.id) + '">拉取模型清单</button>'}
    </div>
    <div class="hint">${isLocal ? '保存后可用下方的「测试连接」确认 ComfyUI 在线。' : '保存后可测试连接；模型清单拉取成功只会补充，不会覆盖手填项。'}</div>
  </div>`
}

function renderSettings() {
  const cfg = state.config
  const s = cfg?.settings || {}
  const list = interfaces()
  const migration = cfg?.migration
  const editingId = state.ifaceEditing ? (state.ifaceDraft?.id || '__new__') : ''

  const newDraft = state.ifaceEditing && !(state.ifaceDraft?.id || '') ? state.ifaceDraft : null
  const cards = list.map((it) => ifaceCard(
    it,
    state.ifaceEditing && editingId === it.id ? state.ifaceDraft : null,
  )).join('')
  const newEditor = newDraft ? renderIfaceEditor(newDraft) : ''

  $('#view').innerHTML = `<div class="form">
    ${state.configError ? `<div class="bad">${esc(state.configError)}</div>` : ''}
    ${migration?.warnings?.length ? `<div class="group">
      <div class="ghead"><span class="gname">配置迁移</span></div>
      <div class="hint">${esc(migration.ran ? '已把旧版单接口配置迁移成一条「旧配置」接口（未设默认）。' : '')}</div>
      ${migration.warnings.map((w) => `<div class="hint">· ${esc(w)}</div>`).join('')}
      ${migration.backups?.settings ? `<div class="hint mono">备份：${esc(migration.backups.settings)}</div>` : ''}
      ${migration.backups?.key ? `<div class="hint mono">备份：${esc(migration.backups.key)}</div>` : ''}
    </div>` : ''}

    <div class="group">
      <div class="ghead"><span class="gname">接口</span>
        <span class="hint">默认接口：${esc(defaultInterface()?.name || '未设定（必须手动指定）')}</span></div>
      ${cards || '<div class="empty">还没有接口。先添加一个：云端填 API 地址与密钥；本地填 ComfyUI 地址。</div>'}
      ${newEditor}
      <div class="row">
        <button class="btn" type="button" data-act="iface-new" data-kind="cloud">＋ 云端接口</button>
        <button class="btn" type="button" data-act="iface-new" data-kind="local">＋ 本地 ComfyUI</button>
      </div>
      <div class="hint">同一时间只有一个默认接口；创作页与对话工具默认走它，需要时可在创作页临时切换。</div>
    </div>

    <div class="group">
      <div class="ghead"><span class="gname">默认值</span></div>
      <div class="line"><span class="k">画幅</span><div class="v seg">
        ${SIZE_PRESETS.map((p) => `<button type="button" data-default-size="${esc(p.size)}" aria-pressed="${s.defaultSize === p.size}">${esc(p.label)}</button>`).join('')}
      </div></div>
      <div class="line"><span class="k">张数</span><div class="v seg">
        ${[1, 2, 3, 4].map((n) => `<button type="button" data-default-count="${n}" aria-pressed="${Number(s.defaultCount) === n}">${n}</button>`).join('')}
      </div></div>
      <div class="line"><span class="k">超时(s)</span><div class="v"><input class="input" id="s-timeout" value="${esc(Math.round((s.timeoutMs || 300000) / 1000))}" /></div></div>
      <div class="hint">超时是云端接口的上限；本地 ComfyUI 用接口自己的超时（默认 900s）。</div>
    </div>

    <div class="group">
      <div class="ghead"><span class="gname">数据</span></div>
      <dl class="meta">
        <dt>资产库</dt><dd class="mono">${esc(cfg?.root || state.root || '-')}</dd>
        <dt>配置</dt><dd class="mono">${esc((cfg?.root || state.root || '') + '\\配置\\settings.json')}</dd>
        <dt>密钥</dt><dd class="mono">${esc((cfg?.root || state.root || '') + '\\配置\\密钥\\<接口id>.dat')}</dd>
        <dt>资产</dt><dd>${state.assets.length} 张</dd>
      </dl>
      <div class="hint">密钥用 Windows DPAPI 加密，只有当前 Windows 用户能解开；面板与日志都拿不到明文。换用户或重装系统需重新输入。</div>
    </div>
  </div>`

  const view = $('#view')

  // ---- 新增 / 编辑 / 保存 ----

  view.querySelectorAll('[data-act="iface-new"]').forEach((b) => b.addEventListener('click', () => {
    state.ifaceDraft = blankInterface(b.dataset.kind)
    state.ifaceEditing = true
    state.testResult = null
    renderSettings()
  }))

  view.querySelectorAll('[data-act="iface-edit"]').forEach((b) => b.addEventListener('click', () => {
    const it = list.find((x) => x.id === b.dataset.id)
    if (!it) return
    state.ifaceDraft = {
      ...JSON.parse(JSON.stringify(it)),
      comfy: it.comfy || blankInterface('local').comfy,
    }
    state.ifaceEditing = true
    state.testResult = null
    void loadModels(it.id).then(() => renderSettings())
  }))

  view.querySelector('[data-act="iface-cancel"]')?.addEventListener('click', () => {
    state.ifaceDraft = null
    state.ifaceEditing = false
    renderSettings()
  })

  view.querySelectorAll('[data-edit-kind]').forEach((b) => b.addEventListener('click', () => {
    if (!state.ifaceDraft) return
    state.ifaceDraft.kind = b.dataset.editKind
    if (state.ifaceDraft.kind === 'local' && !state.ifaceDraft.baseUrl) state.ifaceDraft.baseUrl = 'http://127.0.0.1:8188'
    if (state.ifaceDraft.kind === 'local' && !state.ifaceDraft.comfy) state.ifaceDraft.comfy = blankInterface('local').comfy
    renderSettings()
  }))

  view.querySelector('[data-edit-toggle-enabled]')?.addEventListener('click', (e) => {
    if (!state.ifaceDraft) return
    state.ifaceDraft.enabled = state.ifaceDraft.enabled === false
    e.currentTarget.setAttribute('aria-pressed', String(state.ifaceDraft.enabled !== false))
  })

  view.querySelectorAll('[data-act="iface-save"]').forEach((b) => b.addEventListener('click', async () => {
    const draft = state.ifaceDraft
    if (!draft) return
    // 只提交可编辑的字段：key/templates 是服务端算出来的视图，不回传
    const { key: _key, templates: _tpl, ...clean } = draft
    const body = {
      interface: {
        ...clean,
        name: view.querySelector('#e-name')?.value.trim() || draft.name,
        baseUrl: view.querySelector('#e-baseurl')?.value.trim() || draft.baseUrl,
        defaultModel: view.querySelector('#e-model')?.value.trim() || '',
        models: (view.querySelector('#e-models')?.value || '').split(/\r?\n/).map((x) => x.trim()).filter(Boolean),
      },
    }
    if (draft.kind === 'local') {
      const wf = {}
      for (const slot of SLOT_ORDER) {
        const el = view.querySelector(`#e-wf-${slot}`)
        if (el) wf[slot] = el.value.trim()
      }
      body.interface.comfy = {
        ...(draft.comfy || {}),
        workflows: wf,
        timeoutMs: Math.round(Number(view.querySelector('#e-timeout')?.value || 900) * 1000),
        steps: Number(view.querySelector('#e-steps')?.value || 25),
        cfg: Number(view.querySelector('#e-cfg')?.value || 2.5),
        sampler: view.querySelector('#e-sampler')?.value.trim() || '',
        scheduler: view.querySelector('#e-scheduler')?.value.trim() || '',
        negative: view.querySelector('#e-negative')?.value || '',
      }
    } else {
      delete body.interface.comfy // 云端接口不写本地工作流配置
    }
    try {
      state.config = await svc('POST', '/interfaces', body)
      state.ifaceDraft = null
      state.ifaceEditing = false
      await toast('success', '接口已保存')
      await loadModels()
    } catch (err) {
      await toast('error', '保存失败：' + describeHostError(err))
    }
    renderSettings()
  }))

  view.querySelectorAll('[data-act="iface-default"]').forEach((b) => b.addEventListener('click', async () => {
    try {
      state.config = await svc('POST', `/interfaces/${encodeURIComponent(b.dataset.id)}/default`)
      state.draft.interfaceId = ''
      state.draft.model = ''
      await toast('success', '已设为默认接口')
      await loadModels()
    } catch (err) {
      await toast('error', '设置失败：' + describeHostError(err))
    }
    renderSettings()
  }))

  view.querySelectorAll('[data-act="iface-del"]').forEach((b) => {
    let armed = false
    b.addEventListener('click', async () => {
      if (!armed) {
        armed = true
        b.textContent = '再点一次确认删除'
        setTimeout(() => { armed = false; b.textContent = '删除' }, 4000)
        return
      }
      try {
        state.config = await svc('POST', `/interfaces/${encodeURIComponent(b.dataset.id)}/delete`)
        await toast('success', '接口已删除（含它的密钥文件）')
        await loadModels()
      } catch (err) {
        await toast('error', '删除失败：' + describeHostError(err))
      }
      renderSettings()
    })
  })

  view.querySelectorAll('[data-act="iface-test"]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.id
    state.testResult = null
    await toast('info', '正在测试连接…')
    try {
      const data = await svc('POST', `/interfaces/${encodeURIComponent(id)}/test`, {})
      state.testResult = { id, ...data }
      if (data.ok && data.kind === 'cloud') state.models = data.models || []
      if (data.ok) await toast('success', '连接正常')
      else await toast('error', data.error || '连接失败')
    } catch (err) {
      state.testResult = { id, ok: false, error: describeHostError(err) }
      await toast('error', describeHostError(err))
    }
    renderSettings()
    if (state.testResult && !state.testResult.ok) {
      const el = view.querySelector(`[data-iface="${CSS.escape(id)}"]`)
      if (el) el.insertAdjacentHTML('beforeend', `<div class="bad">${esc(state.testResult.error || '连接失败')}</div>`)
    } else if (state.testResult?.ok) {
      const el = view.querySelector(`[data-iface="${CSS.escape(id)}"]`)
      if (el) el.insertAdjacentHTML('beforeend', `<div class="ok">${
        state.testResult.kind === 'local'
          ? `ComfyUI ${esc(state.testResult.stats?.version || '')} 在线`
          : `已连接 · ${state.testResult.total || 0} 个模型`
      }</div>`)
    }
  }))

  // 拉取模型清单（只补充，不覆盖手填；结果直接写回接口的 models）
  view.querySelectorAll('[data-act="iface-pull"]').forEach((b) => b.addEventListener('click', async () => {
    const id = b.dataset.id
    const it = list.find((x) => x.id === id)
    if (!it) return
    await toast('info', '正在拉取模型清单…')
    try {
      const data = await svc('GET', `/models?interface=${encodeURIComponent(id)}`)
      if (!data.ok) { await toast('error', data.error || '拉取失败'); return }
      const merged = [...new Set([...(it.models || []), ...(data.models || []).map((m) => m.id)])]
      state.config = await svc('POST', '/interfaces', {
        interface: { ...JSON.parse(JSON.stringify(it)), models: merged, defaultModel: it.defaultModel },
      })
      await toast('success', `已补入 ${merged.length} 个模型（手填项保留）`)
      await loadModels(id)
    } catch (err) {
      await toast('error', '拉取失败：' + describeHostError(err))
    }
    renderSettings()
  }))

  // ---- 默认值 ----

  view.querySelectorAll('[data-default-size]').forEach((b) => b.addEventListener('click', async () => {
    try {
      state.config = await svc('POST', '/config', { defaultSize: b.dataset.defaultSize })
      state.draft.size = b.dataset.defaultSize
    } catch (err) { await toast('error', describeHostError(err)) }
    renderSettings()
  }))

  view.querySelectorAll('[data-default-count]').forEach((b) => b.addEventListener('click', async () => {
    try {
      state.config = await svc('POST', '/config', { defaultCount: Number(b.dataset.defaultCount) })
      state.draft.count = Number(b.dataset.defaultCount)
    } catch (err) { await toast('error', describeHostError(err)) }
    renderSettings()
  }))

  view.querySelector('#s-timeout')?.addEventListener('change', async (e) => {
    const secs = Number(e.target.value)
    if (!Number.isFinite(secs)) return
    try {
      state.config = await svc('POST', '/config', { timeoutMs: Math.round(secs * 1000) })
      await toast('success', '超时已保存')
    } catch (err) {
      await toast('error', '保存失败：' + describeHostError(err))
    }
    renderSettings()
  })

  // 密钥编辑：只在展开的编辑器里出现
  const editor = view.querySelector('.iface-edit')
  if (editor && state.ifaceDraft) {
    editor.insertAdjacentHTML('beforeend', `<div class="group" style="margin-top:6px">
      <div class="ghead"><span class="gname">密钥</span>
        <span class="hint">${esc(state.ifaceDraft.kind === 'local' ? '本地接口通常不需要' : 'DPAPI 加密保存')}</span></div>
      <input class="input" id="e-key" type="password" placeholder="输入新密钥后点保存（不会显示明文）" autocomplete="off" />
      <div class="row">
        <button class="btn primary" type="button" data-act="key-save">保存密钥</button>
        <button class="btn danger" type="button" data-act="key-clear">清除密钥</button>
      </div>
    </div>`)
    editor.querySelector('[data-act="key-save"]').addEventListener('click', async () => {
      const apiKey = editor.querySelector('#e-key').value.trim()
      if (!apiKey) { await toast('error', '请先输入密钥'); return }
      const id = state.ifaceDraft.id
      if (!id) { await toast('error', '请先保存接口，再单独保存密钥'); return }
      try {
        state.config = await svc('POST', `/interfaces/${encodeURIComponent(id)}/key`, { apiKey })
        editor.querySelector('#e-key').value = ''
        await toast('success', '密钥已加密保存')
      } catch (err) {
        await toast('error', '保存失败：' + describeHostError(err))
      }
      renderSettings()
    })
    editor.querySelector('[data-act="key-clear"]').addEventListener('click', async () => {
      const id = state.ifaceDraft.id
      if (!id) return
      try {
        state.config = await svc('POST', `/interfaces/${encodeURIComponent(id)}/key`, { clear: true })
        await toast('success', '密钥已清除')
      } catch (err) {
        await toast('error', '清除失败：' + describeHostError(err))
      }
      renderSettings()
    })
  }
}


// ---- 参考图选择器 ----

function openPicker() {
  const el = $('#pick')
  el.hidden = false
  el.innerHTML = `
    <div class="dhead" style="position:sticky;top:0;background:var(--background);display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid var(--border)">
      <strong>选择参考图</strong>
      <button class="btn" type="button" data-act="pick-close">关闭</button>
    </div>
    <div class="pbody">
      ${state.assets.length ? `<div class="grid">${state.assets.map((a) => `
        <figure class="tile" data-pick="${esc(a.id)}" style="margin:0">
          ${imgSrc(a.id) ? `<img src="${imgSrc(a.id)}" alt="" />` : `<span class="ph" style="aspect-ratio:3/4"></span>`}
          <figcaption>${esc(fmtTime(a.createdAt))}</figcaption>
        </figure>`).join('')}</div>` : '<div class="empty">资产库还是空的</div>'}
    </div>`
  el.querySelector('[data-act="pick-close"]').addEventListener('click', () => { el.hidden = true; el.innerHTML = '' })
  el.querySelectorAll('[data-pick]').forEach((fig) => fig.addEventListener('click', () => {
    const id = fig.dataset.pick
    if (!state.draft.refs.some((r) => r.id === id) && state.draft.refs.length < MAX_REFERENCES) {
      const rec = state.assets.find((a) => a.id === id)
      state.draft.refs.push({ id, name: rec?.file || id })
      void saveDraft()
    }
    el.hidden = true
    el.innerHTML = ''
    renderCreate()
  }))
}

// ---- 生成 ----

async function startGenerate() {
  if (state.generating) return
  const d = state.draft
  if (!d.prompt.trim()) { await toast('error', '提示词不能为空'); return }
  const iface = activeInterface()
  if (!iface) { await toast('error', '还没有可用接口：请到设置页添加并指定默认接口'); return }
  state.generating = true
  state.job = { status: 'running', pct: 0, phase: '提交…' }
  renderCreate()
  try {
    const data = await svc('POST', '/generate', {
      prompt: d.prompt.trim(),
      model: d.model || iface.defaultModel || '',
      size: d.size,
      count: d.count,
      transparent: d.transparent && !d.refs.length,
      references: d.refs.map((r) => r.id),
      interfaceId: iface.id,
      sessionId: state.session?.id || null,
      sessionTitle: state.session?.title || null,
      projectDirectory: state.session?.directory || null,
    })
    state.job = { id: data.jobId, status: 'running', pct: 0, phase: '排队…' }
    renderCreate()
    void pollJob(data.jobId)
  } catch (err) {
    state.job = { status: 'error', pct: 100, phase: '失败', error: describeHostError(err) }
    state.generating = false
    renderCreate()
  }
}

async function pollJob(jobId) {
  for (let i = 0; i < 120; i++) {
    if (!state.job || state.job.id !== jobId) return
    await new Promise((r) => setTimeout(r, 3000))
    if (!state.job || state.job.id !== jobId) return
    if (state.job.status === 'done' || state.job.status === 'error') return
    try {
      const job = await svc('GET', `/generate/${jobId}`)
      if (state.job?.id !== jobId) return
      state.job = { ...state.job, ...job }
      if (job.status === 'done' || job.status === 'error') {
        state.generating = false
        renderCreate()
        if (job.status === 'done') {
          await toast('success', `已生成 ${job.result?.assets?.length || 0} 张并入库`)
          void refresh()
        }
        return
      }
      renderCreate()
    } catch {
      /* 任务过期或服务重启：下一轮再试 */
    }
  }
}

// ---- 详情 / 管理 ----

function openDetail(id) {
  state.selected = id
  renderDetail()
  $('#detail').hidden = false
}

function closeDetail() {
  state.selected = null
  $('#detail').hidden = true
  $('#detail').innerHTML = ''
}

function refsOf(rec) {
  if (Array.isArray(rec.references) && rec.references.length) return rec.references
  if (Array.isArray(rec.referenceIds) && rec.referenceIds.length) {
    return rec.referenceIds.map((id) => ({ kind: 'asset', id }))
  }
  return []
}

function rebuildKind(rec) {
  const k = rec.interfaceKind || rec.source || ''
  return k === 'local' || k === 'comfyui' ? '本地 ComfyUI' : k === 'cloud' ? '云端 API' : '未知来源'
}

function describeEndpoint(rec) {
  const e = String(rec.endpoint || '')
  if (e.startsWith('comfyui:')) {
    const slot = e.slice('comfyui:'.length)
    return `本地 ${SLOT_LABEL[slot] || slot}（ComfyUI 工作流）`
  }
  if (e === '/images/edits') return '参考图生图'
  if (e === '/images/generations') return '文生图'
  return '-'
}

function renderDetail() {
  const rec = state.assets.find((a) => a.id === state.selected)
  if (!rec) { closeDetail(); return }
  const el = $('#detail')
  const src = imgSrc(rec.id)
  const abs = state.root ? `${state.root}\\${rec.file}` : rec.file
  const refs = refsOf(rec)
  const usage = fmtUsage(rec.usage)
  const actual = rec.width && rec.height ? `${rec.width} × ${rec.height}` : '?'
  const requested = rec.requestedSize || rec.apiSize || ''
  const sizeMismatch = requested && rec.width && rec.height && requested !== `${rec.width}x${rec.height}`

  el.innerHTML = `
    <div class="dhead">
      <strong>资产详情</strong>
      <button class="btn" type="button" data-act="close">关闭</button>
    </div>
    <div class="dbody">
      ${src
        ? `<img class="big" data-id="${esc(rec.id)}" src="${src}" alt="" />`
        : `<img class="big" data-id="${esc(rec.id)}" src="" alt="" style="aspect-ratio:${rec.width || 3}/${rec.height || 4}" />`}

      ${refs.length ? `<div class="section-label">参考图 ${refs.length} 张</div>
        <div class="refrow">${refs.map((r) => {
          if (r.kind === 'asset' && r.id) {
            return `<button type="button" data-open-asset="${esc(r.id)}" title="${esc(r.name || r.id)}">
              <img data-id="${esc(r.id)}" src="${imgSrc(r.id)}" alt="" /></button>`
          }
          if (r.file) {
            return `<button type="button" data-ref-file="${esc(r.file)}" title="${esc(r.path || r.name || '')}">
              <img data-ref="${esc(r.file)}" src="${refCache.get(r.file) || ''}" alt="" /></button>`
          }
          return `<span class="chip">${esc(r.name || r.path || '参考图')}</span>`
        }).join('')}</div>` : ''}

      <div class="prompt">${esc(rec.prompt || '（无提示词）')}</div>

      <dl class="meta">
        <dt>尺寸</dt><dd>${esc(actual)}${requested ? `（请求 ${esc(requested)}）` : ''}${sizeMismatch ? ' <span class="hint">模型自行调整了尺寸</span>' : ''}</dd>
        <dt>格式</dt><dd>${esc((rec.format || '?').toUpperCase())} · ${esc(fmtSize(rec.bytes || 0))}${rec.alpha && rec.format === 'png' ? ' · 可能含透明通道' : ''}</dd>
        <dt>模型</dt><dd>${esc(rec.model || '-')}</dd>
        <dt>接口</dt><dd>${esc(rec.interfaceName ? `${rec.interfaceName}（${rebuildKind(rec)}）` : '-')}</dd>
        <dt>方式</dt><dd>${esc(describeEndpoint(rec))}</dd>
        ${usage ? `<dt>用量</dt><dd>${esc(usage)}</dd>` : ''}
        <dt>时间</dt><dd>${esc(fmtTime(rec.createdAt))}</dd>
        <dt>会话</dt><dd>${esc(rec.sessionTitle || '-')}${rec.sessionId ? ` <span class="hint">(${esc(rec.sessionId)})</span>` : ''}</dd>
        <dt>文件</dt><dd class="mono" title="${esc(abs)}">${esc(abs)}</dd>
        <dt>资产 id</dt><dd class="mono">${esc(rec.id)}</dd>
      </dl>

      <div class="row">
        <button class="btn primary" type="button" data-act="use-ref">以此图为参考</button>
        <button class="btn" type="button" data-act="copy-prompt">复用提示词</button>
      </div>

      <div class="section-label">标签</div>
      <div class="chips" id="d-tags">
        ${(rec.tags || []).map((t) =>
          `<span class="chip">${esc(t)}<button type="button" data-del-tag="${esc(t)}" aria-label="移除 ${esc(t)}">×</button></span>`).join('')
          || '<span class="hint">暂无标签</span>'}
      </div>
      <div class="tagadd">
        <input class="input" id="d-tag-input" placeholder="输入标签后回车添加" maxlength="40" />
        <button class="btn" type="button" data-act="add-tag">添加</button>
      </div>

      <div class="section-label">备注</div>
      <textarea class="textarea" id="d-note" rows="3" maxlength="2000" placeholder="手动标注：写下这张图的用途、结论、待办…">${esc(rec.note || '')}</textarea>

      <div class="row">
        <button class="btn primary" type="button" data-act="save">保存标注</button>
        <button class="btn" type="button" data-act="copy">复制路径</button>
        <button class="btn danger" type="button" data-act="del" data-armed="false">删除</button>
      </div>
      <div class="hint">删除会同时移除图片文件与索引，不可恢复。</div>
    </div>`

  if (!src) void loadImg(rec.id)
  refs.forEach((r) => {
    if (r.kind === 'asset' && r.id && !imgSrc(r.id)) void loadImg(r.id)
    if (r.file && !refCache.has(r.file)) void loadRefImage(r.file)
  })

  el.querySelector('[data-act="close"]').addEventListener('click', closeDetail)

  el.querySelectorAll('[data-open-asset]').forEach((b) => b.addEventListener('click', () => openDetail(b.dataset.openAsset)))

  el.querySelector('[data-act="use-ref"]')?.addEventListener('click', () => {
    if (!state.draft.refs.some((r) => r.id === rec.id)) {
      state.draft.refs = [...state.draft.refs, { id: rec.id, name: rec.file }].slice(0, MAX_REFERENCES)
    }
    if (!state.draft.prompt && rec.prompt) state.draft.prompt = rec.prompt
    void saveDraft()
    closeDetail()
    state.tab = 'create'
    render()
  })

  el.querySelector('[data-act="copy-prompt"]')?.addEventListener('click', async () => {
    try {
      await host.writeClipboard(rec.prompt || '')
      await toast('success', '提示词已复制')
    } catch (err) {
      await toast('error', '复制失败：' + describeHostError(err))
    }
  })

  el.querySelectorAll('[data-del-tag]').forEach((b) => {
    b.addEventListener('click', () => {
      const next = (rec.tags || []).filter((t) => t !== b.dataset.delTag)
      void pushAnnotate(rec.id, { tags: next })
    })
  })

  const addTag = () => {
    const input = el.querySelector('#d-tag-input')
    const v = input.value.trim()
    if (!v) return
    input.value = ''
    const next = [...(rec.tags || [])]
    if (!next.includes(v)) next.push(v)
    void pushAnnotate(rec.id, { tags: next })
  }
  el.querySelector('[data-act="add-tag"]').addEventListener('click', addTag)
  el.querySelector('#d-tag-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addTag() }
  })

  el.querySelector('[data-act="save"]').addEventListener('click', () => {
    void pushAnnotate(rec.id, { note: el.querySelector('#d-note').value })
  })

  el.querySelector('[data-act="copy"]').addEventListener('click', async () => {
    try {
      await host.writeClipboard(abs)
      await toast('success', '路径已复制')
    } catch (err) {
      await toast('error', '复制失败：' + describeHostError(err))
    }
  })

  const delBtn = el.querySelector('[data-act="del"]')
  let armed = false
  let armTimer = null
  delBtn.addEventListener('click', () => {
    if (!armed) {
      armed = true
      delBtn.dataset.armed = 'true'
      delBtn.textContent = '再点一次确认删除'
      armTimer = setTimeout(() => {
        armed = false
        delBtn.dataset.armed = 'false'
        delBtn.textContent = '删除'
      }, 4000)
      return
    }
    clearTimeout(armTimer)
    void doDelete(rec.id)
  })
}

// ---- 事件接线 ----

function mount() {
  $('#tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab')
    if (!btn) return
    state.tab = btn.dataset.tab
    render()
    if (state.tab === 'settings' && !state.config) {
      void (async () => {
        await loadConfig()
        await loadModels()
        renderSettings()
      })()
    }
    if (state.tab === 'create') void loadModels().then(() => renderCreate())
  })
  $('#q').addEventListener('input', (e) => {
    state.q = e.target.value.trim()
    render()
  })
  $('#tagrow').addEventListener('click', (e) => {
    const btn = e.target.closest('.tagchip')
    if (!btn) return
    state.tag = state.tag === btn.dataset.tag ? '' : btn.dataset.tag
    render()
  })
  $('#banner-retry').addEventListener('click', () => void refresh())
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.selected) closeDetail()
  })
}

let mounted = false
host.onReady(async (ctx) => {
  try { applyHostReady(ctx, document.documentElement) } catch { /* 旧宿主 */ }
  try {
    document.documentElement.dataset.theme = ctx.theme?.mode || 'light'
  } catch { /* 忽略 */ }
  if (ctx.session?.id) state.session = ctx.session
  if (!mounted) {
    mounted = true
    mount()
  }
  await loadDraft()
  void refresh()
  void loadConfig().then(async () => {
    await loadModels()
    if (state.tab === 'settings') renderSettings()
    if (state.tab === 'create') renderCreate()
  })
})

host.onSession((session) => {
  state.session = session
  render()
})

host.onServiceEvent((evt) => {
  if (!evt) return
  if (evt.topic === 'assets-changed') void refresh()
  if (evt.topic === 'config-changed') void loadConfig().then(() => { if (state.tab === 'settings') renderSettings() })
  if (evt.topic === 'generate-progress' && state.job?.id === evt.data?.jobId) {
    state.job = { ...state.job, status: 'running', phase: evt.data.phase, pct: evt.data.pct }
    if (state.tab === 'create') renderCreate()
  }
  if (evt.topic === 'generate-done' && state.job?.id === evt.data?.jobId) {
    if (evt.data.ok) {
      state.job = { ...state.job, status: 'done', pct: 100, phase: '完成', result: { assets: evt.data.assets || [] } }
      state.generating = false
      void toast('success', `已生成 ${(evt.data.assets || []).length} 张并入库`)
      void refresh()
    } else {
      state.job = { ...state.job, status: 'error', pct: 100, phase: '失败', error: evt.data.error }
      state.generating = false
    }
    if (state.tab === 'create') renderCreate()
  }
})

// 兜底轮询：错过推送、服务空闲重启都能被拉齐（仅在页面可见时）
setInterval(() => {
  if (!document.hidden && (state.tab === 'session' || state.tab === 'all')) void refresh()
}, 10_000)
