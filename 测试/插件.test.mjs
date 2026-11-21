// 插件 dry-run 测试：mock fetch 与宿主 ctx，全流程不联网。
// 覆盖：工具注册形态（generate / generate_video / status）、云端链路、模型预检、单次纪律、本地 ComfyUI 路由。

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP_ROOT = path.join(os.tmpdir(), '生图扩展测试')
fs.mkdirSync(TMP_ROOT, { recursive: true })
const LIB = fs.mkdtempSync(path.join(TMP_ROOT, 'plug-'))

process.env.IMAGE_ASSETS_ROOT = LIB
process.env.IMAGE_ASSETS_KEY_DRYRUN = 'sk-dryrun-key'

const { default: plugin } = await import('../plugin/index.js')
const { writeSettings } = await import('../源码/共享/配置.js')

function pngB64(w = 64, h = 96) {
  const b = Buffer.alloc(64)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8); b.write('IHDR', 12)
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20)
  return b.toString('base64')
}

function pngBytes(w = 64, h = 96) {
  return Buffer.from(pngB64(w, h), 'base64')
}

// 每次注册都捕获工具，返回按名字索引的注册列表
async function registerAll() {
  const tools = []
  const ctx = {
    location: { directory: 'D:/proj/demo' },
    session: { get: async () => ({ title: '演示会话' }) },
    tool: {
      transform: async (cb) => {
        cb({ namespace: () => {}, add: (t) => tools.push(t) })
        return { dispose: async () => {} }
      },
    },
  }
  await plugin.setup(ctx)
  return Object.fromEntries(tools.map((t) => [t.name, t]))
}

function makeExecContext(sessionID = 'ses_dry') {
  const progresses = []
  return {
    sessionID,
    progress: async ({ status }) => { progresses.push(status) },
    progresses,
  }
}

/** 在资产库里放一个「云端」接口（密钥走环境变量 IMAGE_ASSETS_KEY_DRYRUN）。 */
function setupCloud(opts = {}) {
  const id = opts.id || 'dryrun'
  const s = writeSettings(LIB, {
    interfaces: [{
      id,
      name: opts.name || 'dry-run 云端',
      kind: 'cloud',
      baseUrl: opts.baseUrl || 'https://api.example.com/v1',
      defaultModel: opts.defaultModel === undefined ? 'gpt-image-2.6-sunburst' : opts.defaultModel,
      models: opts.models || [],
    }],
    defaultInterface: opts.defaultInterface === undefined ? id : opts.defaultInterface,
  })
  return s
}

/** 在资产库里放一个「本地」接口。 */
function setupLocal(opts = {}) {
  const id = opts.id || 'comfy'
  const s = writeSettings(LIB, {
    interfaces: [{
      id,
      name: '本地 ComfyUI',
      kind: 'local',
      baseUrl: opts.baseUrl || 'http://127.0.0.1:8188',
      defaultModel: '',
      comfy: { workflows: { t2i: opts.t2i || '', i2i: opts.i2i || '', video: opts.video || '' } },
    }],
    defaultInterface: id,
  })
  return s
}

const realFetch = globalThis.fetch
test.after(() => {
  globalThis.fetch = realFetch
  fs.rmSync(LIB, { recursive: true, force: true })
})

test('插件注册：namespace + 三个工具（generate / generate_video / status）', async () => {
  const tools = await registerAll()
  assert.deepEqual(Object.keys(tools).sort(), ['generate', 'generate_video', 'status'])
  assert.deepEqual(tools.generate.input.required, ['prompt'])
  assert.equal(tools.generate.input.properties.size.type, 'string')
  assert.equal(tools.generate.input.properties.images.type, 'array')
  assert.ok(tools.generate.input.properties.interface, '可用 interface 覆盖默认接口')
  assert.ok(tools.generate.description.includes('不要自动重试'))
  assert.ok(tools.generate.description.includes('默认接口'))
  assert.ok(tools.generate_video.description.includes('视频'))
  assert.deepEqual(tools.status.input.required ?? [], [])
})

test('没有接口时：generate 给出「还没有配置任何接口」，不发起网络请求', async () => {
  writeSettings(LIB, { interfaces: [], defaultInterface: '' })
  const tools = await registerAll()
  let net = 0
  globalThis.fetch = async () => { net++; throw new Error('不应联网') }
  await assert.rejects(
    () => tools.generate.execute({ prompt: 'x' }, makeExecContext()),
    (err) => /还没有配置任何接口/.test(err.message) && /不要自动重试/.test(err.message),
  )
  assert.equal(net, 0)
})

test('多接口但没有默认接口：报「没有设定默认接口」，可用 interface 指定', async () => {
  const s = writeSettings(LIB, {
    interfaces: [
      { id: 'a', name: 'A', kind: 'cloud', baseUrl: 'https://a.example/v1', defaultModel: 'm-a' },
      { id: 'b', name: 'B', kind: 'cloud', baseUrl: 'https://b.example/v1', defaultModel: 'm-b' },
    ],
    defaultInterface: '',
  })
  const tools = await registerAll()
  let net = 0
  globalThis.fetch = async () => { net++; throw new Error('不应联网') }
  await assert.rejects(
    () => tools.generate.execute({ prompt: 'x' }, makeExecContext()),
    (err) => /没有设定默认接口/.test(err.message) && err.message.includes('a') && err.message.includes('b'),
  )
  assert.equal(net, 0)

  // 显式指定不存在的接口
  await assert.rejects(
    () => tools.generate.execute({ prompt: 'x', interface: 'nope' }, makeExecContext()),
    /接口不存在/
  )
  assert.equal(s.interfaces.length, 2)
})

test('云端 dry-run：模型预检 + b64 生成 → 入库成功，进度有上报', async () => {
  setupCloud()
  const tools = await registerAll()

  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    if (String(url).endsWith('/models')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'gpt-image-2.6-sunburst' }, { id: 'glm-4.6' }] }) }
    }
    if (String(url).endsWith('/images/generations')) {
      const body = JSON.parse(init.body)
      assert.equal(body.response_format, undefined)
      assert.equal(body.model, 'gpt-image-2.6-sunburst')
      assert.equal(body.size, '1024x1536')
      assert.equal(body.n, 1)
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ b64_json: pngB64(1024, 1536) }] }) }
    }
    throw new Error('意外的请求: ' + url)
  }

  const execCtx = makeExecContext()
  const result = await tools.generate.execute({ prompt: '测试提示词：普拉提馆', tags: ['测试'], note: 'dry-run' }, execCtx)
  assert.ok(result.content.includes('已生成并入库'))
  assert.ok(result.content.includes(LIB))
  assert.ok(execCtx.progresses.some((p) => p.includes('核验模型')))
  assert.equal(calls.length, 2, '应先查模型清单再生成')

  const before = fs.readdirSync(path.join(LIB, '索引')).length
  const rec = JSON.parse(fs.readFileSync(
    path.join(LIB, '索引', fs.readdirSync(path.join(LIB, '索引')).sort().at(-1)), 'utf8'))
  assert.equal(rec.sessionId, 'ses_dry')
  assert.equal(rec.sessionTitle, '演示会话')
  assert.equal(rec.projectDirectory, 'D:/proj/demo')
  assert.equal(rec.width, 1024)
  assert.equal(rec.interfaceId, 'dryrun')
  assert.equal(rec.interfaceKind, 'cloud')
  assert.equal(rec.source, 'cloud')
  assert.deepEqual(rec.tags, ['测试'])
  assert.equal(rec.note, 'dry-run')
  assert.equal(before, fs.readdirSync(path.join(LIB, '索引')).length)
})

test('云端：环境变量密钥不存在时报缺失，不联网', async () => {
  const s = setupCloud({ id: 'nokey', name: '无密钥' })
  const tools = await registerAll()
  let net = 0
  globalThis.fetch = async () => { net++; throw new Error('不应联网') }
  await assert.rejects(
    () => tools.generate.execute({ prompt: 'x', interface: 'nokey' }, makeExecContext()),
    (err) => /没有可用密钥/.test(err.message) && /IMAGE_ASSETS_KEY_NOKEY/.test(err.message),
  )
  assert.equal(net, 0)
  assert.equal(s.defaultInterface, 'nokey')
})

test('模型下线：预检拦截并列出可用图像模型，不发起生成', async () => {
  setupCloud()
  const tools = await registerAll()
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/models')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'grok-imagine-image-2.0' }] }) }
    }
    throw new Error('预检失败后不应发起生成')
  }
  await assert.rejects(
    () => tools.generate.execute({ prompt: 'x' }, makeExecContext()),
    (err) => err.message.includes('不在役') && err.message.includes('grok-imagine-image-2.0') && err.message.includes('不要自动重试'),
  )
})

test('生成失败（503）：结构化报告 + 单次纪律，不发起第二次生成', async () => {
  setupCloud()
  const tools = await registerAll()
  let generateCalls = 0
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/models')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: 'gpt-image-2.6-sunburst' }] }) }
    }
    generateCalls++
    return { ok: false, status: 503, text: async () => 'No available channel' }
  }
  await assert.rejects(
    () => tools.generate.execute({ prompt: 'x' }, makeExecContext()),
    (err) => err.message.includes('503') && err.message.includes('不要自动重试') && err.message.includes('经用户确认'),
  )
  assert.equal(generateCalls, 1, '失败后不自动重发')
})

// ---- 本地 ComfyUI 路由 ----

test('本地 ComfyUI：文生图走 /prompt → /history → /view，图片入库并标记来源', async () => {
  setupLocal()
  const tools = await registerAll()
  const api = await import('../源码/共享/ComfyUI.js')
  const realPatch = api.patchTemplate

  const template = {
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'moss_t2i', images: ['18:8', 0] } },
    '19': { class_type: 'ResolutionSelector', inputs: { aspect_ratio: '1:1 (Square)', megapixels: 1, multiple: 16 } },
    '18:17': { class_type: 'PrimitiveStringMultiline', inputs: { value: 'old prompt' } },
    '18:6': { class_type: 'EmptyFlux2LatentImage', inputs: { width: ['19', 0], height: ['19', 1], batch_size: 1 } },
    '18:7': { class_type: 'KSampler', inputs: { seed: 1, steps: 25, cfg: 2.5, sampler_name: 'er_sde', scheduler: 'simple', denoise: 1, model: ['18:24', 0], positive: ['18:4', 0], negative: ['18:5', 0], latent_image: ['18:6', 0] } },
    '18:5': { class_type: 'CLIPTextEncode', inputs: { text: 'nsfw, low quality', clip: ['18:2', 0] } },
    '18:11': { class_type: 'TextGenerate', inputs: { prompt: ['18:17', 0] } },
  }

  // 用真实模板文件跑（扩展自带的 工作流/t2i_moss_sft.api.json）
  const calls = []
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url)
    calls.push(u)
    if (u.endsWith('/prompt')) {
      const body = JSON.parse(init.body)
      const promptNode = body.prompt['18:17']
      assert.ok(promptNode, '模板里应有用户提示词节点')
      assert.equal(promptNode.inputs.value, '本地测试提示词', '提示词已打桩')
      assert.ok(!String(promptNode.inputs.value).includes('Cinematic'), '不再保留历史示例提示词')
      return { ok: true, status: 200, text: async () => JSON.stringify({ prompt_id: 'pid-1' }) }
    }
    if (u.includes('/history/pid-1')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ 'pid-1': { status: { status_str: 'success' }, outputs: { 9: { images: [{ filename: 'openchamber_t2i_0001.png', subfolder: '', type: 'output' }] } } } }) }
    }
    if (u.includes('/queue')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ queue_running: [], queue_pending: [] }) }
    }
    if (u.includes('/view')) {
      const bytes = pngBytes(1024, 1024)
      return { ok: true, status: 200, arrayBuffer: async () => bytes }
    }
    throw new Error('意外的请求: ' + u)
  }

  const execCtx = makeExecContext()
  const result = await tools.generate.execute({ prompt: '本地测试提示词' }, execCtx)
  assert.ok(result.content.includes('已生成并入库'))
  assert.ok(result.content.includes('本地 ComfyUI'), '结果里标明走的是本地接口')
  assert.ok(result.content.includes('文生图'), '结果里标明工作流槽位')
  const rec = JSON.parse(fs.readFileSync(
    path.join(LIB, '索引', fs.readdirSync(path.join(LIB, '索引')).sort().at(-1)), 'utf8'))
  assert.equal(rec.source, 'comfyui')
  assert.equal(rec.interfaceKind, 'local')
  assert.equal(rec.endpoint, 'comfyui:t2i')
  assert.equal(rec.workflow, 't2i')
  assert.equal(realPatch, api.patchTemplate)
})

test('本地 ComfyUI：带参考图走 i2i（先 /upload/image，再 LoadImage）', async () => {
  setupLocal()
  const tools = await registerAll()
  const refPath = path.join(TMP_ROOT, `ref-${Date.now()}.png`)
  fs.writeFileSync(refPath, pngBytes(512, 512))

  let uploadedName = ''
  let promptBody = null
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url)
    if (u.endsWith('/upload/image')) {
      const fd = init.body
      assert.ok(fd && typeof fd.get === 'function', '应该是 multipart FormData')
      uploadedName = 'openchamber/ref-test.png'
      return { ok: true, status: 200, text: async () => JSON.stringify({ name: 'ref-test.png', subfolder: 'openchamber' }) }
    }
    if (u.endsWith('/prompt')) {
      promptBody = JSON.parse(init.body)
      return { ok: true, status: 200, text: async () => JSON.stringify({ prompt_id: 'pid-i2i' }) }
    }
    if (u.includes('/history/pid-i2i')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ 'pid-i2i': { status: { status_str: 'success' }, outputs: { 9: { images: [{ filename: 'img.png', subfolder: '', type: 'output' }] } } } }) }
    }
    if (u.includes('/queue')) return { ok: true, status: 200, text: async () => JSON.stringify({ queue_running: [], queue_pending: [] }) }
    if (u.includes('/view')) return { ok: true, status: 200, arrayBuffer: async () => pngBytes(1024, 1024) }
    throw new Error('意外的请求: ' + u)
  }

  const result = await tools.generate.execute({ prompt: '保留人物，只换背景', images: [refPath] }, makeExecContext())
  assert.ok(result.content.includes('图生图'), '带参考图应走 i2i')
  assert.equal(uploadedName, 'openchamber/ref-test.png')
  const loadId = Object.keys(promptBody.prompt).find((id) => promptBody.prompt[id].class_type === 'LoadImage')
  assert.ok(loadId, 'i2i 模板里应有 LoadImage')
  assert.equal(promptBody.prompt[loadId].inputs.image, uploadedName)
  const tg = promptBody.prompt['18:11']
  assert.deepEqual(tg.inputs.image, [loadId, 0], '参考图接到 TextGenerate 的 image 槽')
})

test('本地 ComfyUI：离线时报「连不上 ComfyUI」，不重试', async () => {
  setupLocal({ baseUrl: 'http://127.0.0.1:9' })
  const tools = await registerAll()
  let calls = 0
  globalThis.fetch = async () => { calls++; throw Object.assign(new Error('connect failed'), { cause: { code: 'ECONNREFUSED' } }) }
  await assert.rejects(
    () => tools.generate.execute({ prompt: 'x' }, makeExecContext()),
    (err) => /连不上本地 ComfyUI/.test(err.message) && /不要自动重试/.test(err.message),
  )
  assert.equal(calls, 1, '失败不重试')
})

test('视频：本机没有视频模板 → 明确提示先装模型/填模板', async () => {
  setupLocal()
  const tools = await registerAll()
  let calls = 0
  globalThis.fetch = async () => { calls++; throw new Error('不应联网') }
  await assert.rejects(
    () => tools.generate_video.execute({ prompt: '一个转身的镜头' }, makeExecContext()),
    (err) => /视频工作流还没配置/.test(err.message) && /没有任何视频模型/.test(err.message) || /没有任何视频模型/.test(err.message),
  )
  assert.equal(calls, 0)
})

test('视频：云端接口上调用 → 提示只走本地', async () => {
  setupCloud()
  const tools = await registerAll()
  await assert.rejects(
    () => tools.generate_video.execute({ prompt: 'x' }, makeExecContext()),
    /视频生成只走本地 ComfyUI/,
  )
})

test('status 工具：列接口、标记默认、说明本地工作流，且不含明文密钥', async () => {
  writeSettings(LIB, {
    interfaces: [
      { id: 'c1', name: '云端一号', kind: 'cloud', baseUrl: 'https://a.example/v1', defaultModel: 'm1' },
      { id: 'l1', name: '本地一号', kind: 'local', baseUrl: 'http://127.0.0.1:8188' },
    ],
    defaultInterface: 'l1',
  })
  const tools = await registerAll()
  globalThis.fetch = async () => { throw new Error('不应联网') }
  const r = await tools.status.execute({ probe: false }, makeExecContext())
  assert.ok(r.content.includes('云端一号'))
  assert.ok(r.content.includes('本地一号'))
  assert.ok(r.content.includes('★ 默认'))
  assert.ok(r.content.includes('文生图模板'))
  assert.ok(r.content.includes('默认接口：l1'))
  assert.ok(!r.content.includes('sk-'), 'status 不能泄露密钥')
})
