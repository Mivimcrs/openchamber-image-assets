// service 集成测试：以子进程启动构建产物，走真实 HTTP 校验鉴权与资产接口。
// 临时资产库落在系统临时目录下。

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { saveAsset } from '../源码/共享/资产库.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BUNDLE = path.join(HERE, '..', 'service', 'main.js')
const TMP_ROOT = path.join(os.tmpdir(), '生图扩展测试')
const TOKEN = 'test-token-123'

let child
let base
let root

function pngBytes(w = 100, h = 200) {
  const b = Buffer.alloc(64)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8); b.write('IHDR', 12)
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20)
  return b
}

async function call(method, p, { auth = true, body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: {
      ...(auth ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch { /* 非 JSON */ }
  return { status: res.status, json }
}

test.before(async () => {
  fs.mkdirSync(TMP_ROOT, { recursive: true })
  root = fs.mkdtempSync(path.join(TMP_ROOT, 'svc-'))
  child = spawn(process.execPath, [BUNDLE], {
    env: {
      ...process.env,
      OPENCHAMBER_SERVICE_PORT: '0',
      OPENCHAMBER_SERVICE_TOKEN: TOKEN,
      IMAGE_ASSETS_ROOT: root,
      OPENCHAMBER_HOST_CALLBACK_URL: '', // 无宿主回调：emit 降级
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const port = await new Promise((resolve, reject) => {
    let out = ''
    const to = setTimeout(() => reject(new Error('service 启动超时: ' + out)), 10000)
    child.stdout.on('data', (d) => {
      out += d.toString()
      const m = out.match(/listening on 127\.0\.0\.1:(\d+)/)
      if (m) { clearTimeout(to); resolve(Number(m[1])) }
    })
    child.stderr.on('data', (d) => { out += d.toString() })
    child.on('exit', (code) => { clearTimeout(to); reject(new Error('service 提前退出 code=' + code + ' ' + out)) })
  })
  base = `http://127.0.0.1:${port}`
})

test.after(() => {
  if (child) child.kill('SIGTERM')
  // 只删自己的子目录：删 TMP_ROOT 会和并行跑的 插件.test 抢目录（files.length 0 的偶发失败）
  fs.rmSync(root, { recursive: true, force: true })
})

test('鉴权：无 token 或错 token → 401；正确 token 才放行', async () => {
  assert.equal((await call('GET', '/health', { auth: false })).status, 401)
  assert.equal((await call('GET', '/health', { auth: false }) /* 再确认 */).status, 401)
  const wrong = await fetch(base + '/health', { headers: { Authorization: 'Bearer nope' } })
  assert.equal(wrong.status, 401)
  const ok = await call('GET', '/health')
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.json, { ok: true })
})

test('资产接口：入库→列表过滤→取图→标注→删除 全链路', async () => {
  const bytes = pngBytes(1024, 1536)
  const rec = saveAsset(root, bytes, {
    sessionId: 'ses_alpha', sessionTitle: '会话甲', prompt: '普拉提镜面',
    model: 'gpt-image-2.6-sunburst', tags: ['初始'],
  })
  saveAsset(root, pngBytes(10, 10), { sessionId: 'ses_beta', prompt: '别的' })

  // 列表 + 过滤
  const all = await call('GET', '/assets')
  assert.equal(all.status, 200)
  assert.equal(all.json.total, 2)
  assert.equal(all.json.assets.length, 2)
  assert.equal(all.json.warnings.length, 0)

  const bySession = await call('GET', '/assets?sessionId=ses_alpha')
  assert.equal(bySession.json.assets.length, 1)
  assert.equal(bySession.json.assets[0].id, rec.id)

  const byQuery = await call('GET', '/assets?q=镜面')
  assert.equal(byQuery.json.assets.length, 1)

  const byTag = await call('GET', '/assets?tag=' + encodeURIComponent('初始'))
  assert.equal(byTag.json.assets.length, 1)
  assert.equal((await call('GET', '/assets?tag=不存在')).json.assets.length, 0)

  // 取图（base64 往返）
  const file = await call('GET', `/assets/${rec.id}/file`)
  assert.equal(file.status, 200)
  assert.equal(file.json.mime, 'image/png')
  assert.equal(file.json.width, 1024)
  assert.equal(file.json.height, 1536)
  assert.deepEqual(Buffer.from(file.json.base64, 'base64'), bytes)

  // 标注
  const ann = await call('POST', `/assets/${rec.id}/annotate`, { body: { tags: ['定稿', '客户喜欢'], note: '第一版确认' } })
  assert.equal(ann.status, 200)
  assert.deepEqual(ann.json.asset.tags, ['定稿', '客户喜欢'])
  assert.equal(ann.json.asset.note, '第一版确认')
  const reTagged = await call('GET', '/assets?tag=' + encodeURIComponent('定稿'))
  assert.equal(reTagged.json.assets.length, 1)

  // 删除：索引与图片文件一并消失
  const del = await call('POST', `/assets/${rec.id}/delete`)
  assert.equal(del.status, 200)
  assert.equal(del.json.deleted, true)
  assert.equal((await call('GET', `/assets/${rec.id}/file`)).status, 404)
  assert.equal((await call('GET', '/assets')).json.total, 1)
  const remaining = (await call('GET', '/assets')).json.assets[0]
  assert.ok(!fs.existsSync(path.join(root, rec.file)), '已删除资产的图片文件应不存在')
  assert.ok(fs.existsSync(path.join(root, remaining.file)), '其余资产的图片文件应保留')
})

test('错误面：非法 id、坏 JSON、未知路由', async () => {
  assert.equal((await call('GET', '/assets/../evil/file')).status, 404) // 非法 id 找不到 → 404
  assert.equal((await call('POST', '/assets/nope/annotate', { body: { tags: [] } })).status, 404)
  assert.equal((await call('POST', '/assets/nope/delete')).status, 404)

  const bad = await fetch(base + '/assets/nope/annotate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: '{not json',
  })
  assert.equal(bad.status, 400)

  assert.equal((await call('GET', '/什么鬼')).status, 404)
})
