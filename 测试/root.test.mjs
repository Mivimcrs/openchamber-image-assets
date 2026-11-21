// service 资产库位置接口：查询、切换（整库搬迁/只切换）、恢复默认。
// 每个用例用独立的 APPDATA（位置指针落在那儿），不碰真实配置。
// 注意：启动时不设 IMAGE_ASSETS_ROOT，否则按语义"环境变量覆盖"会拒绝切换。

import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { saveAsset, scanAssets } from '../源码/共享/资产库.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BUNDLE = path.join(HERE, '..', 'service', 'main.js')
const TMP_ROOT = path.join(os.tmpdir(), '生图扩展测试')
const TOKEN = 'test-token-root'

let child
let base
let appData
let home
let libA

function pngBytes(w = 64, h = 64) {
  const b = Buffer.alloc(64)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8); b.write('IHDR', 12)
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20)
  return b
}

async function call(method, p, { body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
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
  const sandbox = fs.mkdtempSync(path.join(TMP_ROOT, 'root-'))
  appData = path.join(sandbox, 'appdata')
  home = path.join(sandbox, 'home')
  libA = path.join(sandbox, 'lib-a')
  fs.mkdirSync(appData, { recursive: true })
  fs.mkdirSync(home, { recursive: true })

  child = spawn(process.execPath, [BUNDLE], {
    env: {
      ...process.env,
      OPENCHAMBER_SERVICE_PORT: '0',
      OPENCHAMBER_SERVICE_TOKEN: TOKEN,
      OPENCHAMBER_HOST_CALLBACK_URL: '',
      APPDATA: appData,
      XDG_CONFIG_HOME: '',
      USERPROFILE: home,
      HOME: home,
      IMAGE_ASSETS_ROOT: '', // 明确不用环境变量，测的是自定义路径
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
  fs.rmSync(path.dirname(appData), { recursive: true, force: true })
})

test('位置：/config 报告来源与候选路径，默认在用户主目录派生', async () => {
  const { status, json } = await call('GET', '/config')
  assert.equal(status, 200)
  assert.equal(json.rootSource, 'default')
  assert.equal(json.rootInfo.source, 'default')
  assert.equal(json.rootInfo.envRoot, '')
  assert.equal(json.rootInfo.locked, false)
  assert.equal(json.rootInfo.defaultRoot, path.join(home, 'openchamber-image-assets'))
  assert.equal(json.root, path.join(home, 'openchamber-image-assets'))
  assert.equal(json.rootInfo.locatorPath, path.join(appData, 'openchamber-image-assets', 'location.json'))
})

test('位置：/root/check 拒绝非法路径，接受可写的空目录', async () => {
  const bad = await call('POST', '/root/check', { body: { root: 'relative/path' } })
  assert.equal(bad.status, 200)
  assert.equal(bad.json.ok, false)

  const rootDir = (await call('GET', '/config')).json.root
  const same = await call('POST', '/root/check', { body: { root: rootDir } })
  assert.equal(same.json.ok, false, '当前路径被拒')

  const target = path.join(path.dirname(rootDir), 'lib-new')
  const ok = await call('POST', '/root/check', { body: { root: target } })
  assert.equal(ok.json.ok, true)
  assert.equal(ok.json.root, path.resolve(target))
})

test('位置：整库搬迁——新库立即可用，源库改名归档，指针写入 APPDATA', async () => {
  const rootDir = (await call('GET', '/config')).json.root
  saveAsset(rootDir, pngBytes(), { prompt: 'a1', sessionId: 's' })
  saveAsset(rootDir, pngBytes(80, 80), { prompt: 'a2', sessionId: 's' })

  const target = path.join(path.dirname(rootDir), 'lib-moved')
  const res = await call('POST', '/root', { body: { root: target, migrate: true } })
  assert.equal(res.status, 200)
  assert.equal(res.json.root, path.resolve(target))
  assert.equal(res.json.rootSource, 'custom')
  assert.equal(res.json.moved.action, 'moved')
  assert.equal(res.json.moved.files > 0, true)
  assert.equal(fs.existsSync(res.json.moved.backup), true, '源库归档目录还在')

  const assets = await call('GET', '/assets')
  assert.equal(assets.json.total, 2, '切换后能读到搬过去的资产')
  assert.equal(scanAssets(res.json.moved.backup).assets.length, 2)

  const locator = path.join(appData, 'openchamber-image-assets', 'location.json')
  assert.equal(fs.existsSync(locator), true, '位置指针落在库外面')
  assert.equal(JSON.parse(fs.readFileSync(locator, 'utf8')).root, path.resolve(target))
})

test('位置：只切换——旧库原样不动，新库为空', async () => {
  const before = (await call('GET', '/config')).json.root
  const target = path.join(path.dirname(before), 'lib-switch-only')

  const res = await call('POST', '/root', { body: { root: target, migrate: false } })
  assert.equal(res.status, 200)
  assert.equal(res.json.moved, null)
  assert.equal(fs.existsSync(before), true, '只切换时旧库保留')
  assert.equal(scanAssets(before).assets.length, 2)

  const assets = await call('GET', '/assets')
  assert.equal(assets.json.total, 0, '新库是空的')
})

test('位置：恢复默认——清掉指针，回到用户主目录派生路径', async () => {
  const res = await call('POST', '/root/reset')
  assert.equal(res.status, 200)
  assert.equal(res.json.rootSource, 'default')
  assert.equal(res.json.root, path.join(home, 'openchamber-image-assets'))
  assert.equal(fs.existsSync(path.join(appData, 'openchamber-image-assets', 'location.json')), false)
})

test('位置：重启后沿用指针（持久化生效）', async () => {
  const target = path.join(home, 'lib-persist')
  const res = await call('POST', '/root', { body: { root: target, migrate: false } })
  assert.equal(res.json.rootSource, 'custom')

  // 起第二个进程：不传任何 IMAGE_ASSETS_ROOT，应读到同一个自定义路径
  const port2 = await new Promise((resolve, reject) => {
    const c2 = spawn(process.execPath, [BUNDLE], {
      env: {
        ...process.env,
        OPENCHAMBER_SERVICE_PORT: '0',
        OPENCHAMBER_SERVICE_TOKEN: TOKEN,
        OPENCHAMBER_HOST_CALLBACK_URL: '',
        APPDATA: appData,
        XDG_CONFIG_HOME: '',
        USERPROFILE: home,
        HOME: home,
        IMAGE_ASSETS_ROOT: '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    const to = setTimeout(() => reject(new Error('第二个 service 启动超时: ' + out)), 10000)
    c2.stdout.on('data', (d) => {
      out += d.toString()
      const m = out.match(/listening on 127\.0\.0\.1:(\d+)/)
      if (m) { clearTimeout(to); resolve({ port: Number(m[1]), child: c2 }) }
    })
    c2.stderr.on('data', (d) => { out += d.toString() })
    c2.on('exit', (code) => { clearTimeout(to); reject(new Error('第二个 service 提前退出 code=' + code + ' ' + out)) })
  })
  try {
    const r = await fetch(`http://127.0.0.1:${port2.port}/config`, { headers: { Authorization: `Bearer ${TOKEN}` } })
    const cfg = await r.json()
    assert.equal(cfg.rootSource, 'custom')
    assert.equal(cfg.root, path.resolve(target))
  } finally {
    port2.child.kill('SIGTERM')
  }
})
