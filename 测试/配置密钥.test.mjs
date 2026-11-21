// 配置（v2 多接口）与密钥（按接口 DPAPI）：容错归一化、迁移、优先级（面板 > 环境变量）。

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  DEFAULT_SETTINGS, readSettings, writeSettings, normalizeSettings, settingsPath, keysDir,
  upsertInterface, removeInterface, resolveInterface, describeInterfaces, normalizeInterface,
  migrateV1, SETTINGS_VERSION, libraryRoot, LIBRARY_DIR_NAME,
  locatorPath, readLocator, writeLocator, clearLocator, resolveLibraryRoot, validateLibraryRoot,
  defaultLibraryRoot,
} from '../源码/共享/配置.js'
import {
  encryptSecret, decryptSecret, saveKey, readStoredKey, clearStoredKey,
  maskKey, checkKey, resolveApiKey, hasStoredKey, envNameFor, keyPath, readLegacyKey,
} from '../源码/共享/密钥.js'
import { migrateIfNeeded } from '../源码/共享/迁移.js'

const TMP = path.join(os.tmpdir(), '生图扩展测试-配置密钥')
fs.mkdirSync(TMP, { recursive: true })

function freshRoot() {
  return fs.mkdtempSync(path.join(TMP, 'cfg-'))
}

test('配置：资产库默认目录由用户主目录派生，环境变量优先，不写死机器路径', () => {
  const home = path.join('C:', 'Users', 'tester')
  assert.equal(libraryRoot({}, home), path.join(home, LIBRARY_DIR_NAME))
  assert.equal(libraryRoot({ IMAGE_ASSETS_ROOT: '  ' }, home), path.join(home, LIBRARY_DIR_NAME), '空值当作没设')
  assert.equal(libraryRoot({ IMAGE_ASSETS_ROOT: path.join(home, 'lib') }, home), path.join(home, 'lib'))
  assert.ok(!libraryRoot({}, home).includes('AppData'), '默认值里不出现本机绝对路径')
})

// 位置指针与路径解析：每个用例用独立的假配置目录（模拟 %APPDATA%），不碰真实文件

function fakeEnv() {
  const dir = fs.mkdtempSync(path.join(TMP, 'loc-'))
  return { env: { APPDATA: dir, XDG_CONFIG_HOME: '' }, home: path.join(dir, 'home'), dir }
}

test('位置：四档解析顺序 显式 > 环境变量 > 自定义 > 出厂默认', () => {
  const { env, home, dir } = fakeEnv()
  const custom = path.join(dir, 'custom-lib')
  assert.equal(resolveLibraryRoot({ env, home }).source, 'default')
  assert.equal(resolveLibraryRoot({ env, home }).root, defaultLibraryRoot(home))

  writeLocator(custom, env, home)
  const withCustom = resolveLibraryRoot({ env, home })
  assert.equal(withCustom.source, 'custom')
  assert.equal(withCustom.root, path.resolve(custom))

  const withEnv = resolveLibraryRoot({ env: { ...env, IMAGE_ASSETS_ROOT: path.join(dir, 'env-lib') }, home })
  assert.equal(withEnv.source, 'env', '环境变量算"有要求"，压过自定义路径')

  const withExplicit = resolveLibraryRoot({ explicit: path.join(dir, 'call-lib'), env, home })
  assert.equal(withExplicit.source, 'explicit', '调用时显式指定最优先')
  assert.equal(withExplicit.root, path.resolve(path.join(dir, 'call-lib')))
})

test('位置：坏指针文件回落到默认，不抛错；清掉后回到默认', () => {
  const { env, home, dir } = fakeEnv()
  const file = locatorPath(env, home)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, '{ 坏掉的 json', 'utf8')
  assert.equal(readLocator(env, home).root, '')
  assert.equal(resolveLibraryRoot({ env, home }).source, 'default')

  writeLocator(path.join(dir, 'lib'), env, home)
  assert.equal(readLocator(env, home).root, path.resolve(path.join(dir, 'lib')))
  clearLocator(env, home)
  assert.equal(readLocator(env, home).root, '')
})

test('位置：路径校验拒绝相对路径、盘符根、当前库、当前库内部、扩展目录', () => {
  const { env, home, dir } = fakeEnv()
  const cur = path.join(dir, 'current-lib')
  const ext = path.join(dir, 'ext-install')
  fs.mkdirSync(cur, { recursive: true })
  fs.mkdirSync(ext, { recursive: true })

  assert.equal(validateLibraryRoot('', { env, currentRoot: cur }).ok, false)
  assert.equal(validateLibraryRoot('relative/dir', { env, currentRoot: cur }).ok, false, '相对路径被拒')
  assert.equal(validateLibraryRoot('C:\\', { env, currentRoot: cur }).ok, false, '盘符根被拒')
  assert.equal(validateLibraryRoot(cur, { env, currentRoot: cur }).ok, false, '当前路径被拒')
  assert.equal(validateLibraryRoot(path.join(cur, 'sub'), { env, currentRoot: cur }).ok, false, '当前库内部被拒')
  assert.equal(validateLibraryRoot(path.join(ext, 'lib'), { env, currentRoot: cur, extRoot: ext }).ok, false, '扩展目录被拒')

  const fresh = path.join(dir, 'new-lib')
  const ok = validateLibraryRoot(fresh, { env, currentRoot: cur })
  assert.equal(ok.ok, true, '不存在的空目录（上级可写）可用')
  assert.equal(ok.root, path.resolve(fresh))
})

test('位置：环境变量已覆盖时面板保存会被明确拒绝（避免"存了却不生效"）', () => {
  const { env, home, dir } = fakeEnv()
  const envRoot = path.join(dir, 'env-lib')
  const verdict = validateLibraryRoot(path.join(dir, 'other'), { env: { ...env, IMAGE_ASSETS_ROOT: envRoot }, currentRoot: envRoot })
  assert.equal(verdict.ok, true, '换到别处仍然可以（只是当前由环境变量决定）')
  // 目标正好等于环境变量所指：拒绝并说明原因
  const same = validateLibraryRoot(envRoot, { env: { ...env, IMAGE_ASSETS_ROOT: envRoot }, currentRoot: path.join(dir, 'x') })
  assert.equal(same.ok, false)
  assert.match(same.error, /环境变量/)
})

test('配置：缺文件 → 默认值（没有任何接口、没有预置服务商）', () => {
  const root = freshRoot()
  const s = readSettings(root)
  assert.equal(s.version, SETTINGS_VERSION)
  assert.deepEqual(s.interfaces, [])
  assert.equal(s.defaultInterface, '', '新装不指定默认接口')
  assert.equal(s.defaultSize, DEFAULT_SETTINGS.defaultSize)
  assert.equal(s.interfaces.length, 0, '默认配置里没有任何预置接口')
})

test('配置：坏 JSON → 回落默认值，不抛错', () => {
  const root = freshRoot()
  fs.mkdirSync(path.dirname(settingsPath(root)), { recursive: true })
  fs.writeFileSync(settingsPath(root), '{ 这不是 json', 'utf8')
  assert.deepEqual(readSettings(root).interfaces, [])
})

test('配置：v1 结构读入即迁移成「旧配置」接口，且不设为默认', () => {
  const root = freshRoot()
  fs.mkdirSync(path.dirname(settingsPath(root)), { recursive: true })
  fs.writeFileSync(settingsPath(root), JSON.stringify({
    version: 1, baseUrl: 'https://api.example.com/v1',
    defaultModel: 'image-model-x', defaultSize: '1024x1536', defaultCount: 1, timeoutMs: 300000,
  }), 'utf8')
  const s = readSettings(root)
  assert.equal(s.interfaces.length, 1)
  assert.equal(s.interfaces[0].id, 'legacy')
  assert.equal(s.interfaces[0].name, '旧配置')
  assert.equal(s.interfaces[0].kind, 'cloud')
  assert.equal(s.interfaces[0].defaultModel, 'image-model-x')
  assert.equal(s.defaultInterface, '', '迁移来的接口不自动成为默认')
})

test('配置：migrateV1 保留 baseUrl / 模型清单，地址非法时容错', () => {
  const s = migrateV1({ baseUrl: 'https://example.com/v1/', defaultModel: 'm1' })
  assert.equal(s.interfaces[0].baseUrl, 'https://example.com/v1')
  assert.deepEqual(s.interfaces[0].models, ['m1'])
  const bad = migrateV1({ baseUrl: 'ftp://x', defaultModel: 'm1' })
  assert.equal(bad.interfaces.length, 1, '不做网络校验，地址原样保留待用户改')
})

test('配置：写入顶层默认值 + 非法字段回落', () => {
  const root = freshRoot()
  const a = writeSettings(root, { defaultSize: '1024x1024', defaultCount: 3 })
  assert.equal(a.defaultSize, '1024x1024')
  assert.equal(a.defaultCount, 3)
  const b = writeSettings(root, { defaultCount: 99, timeoutMs: 1 })
  assert.equal(b.defaultCount, 4, '超范围收敛到 4')
  assert.equal(b.timeoutMs, 30_000, '超时下限 30s')
  assert.equal(b.defaultSize, '1024x1024', '未传的字段保持原值')
})

test('接口：新增 → 编辑 → 设为默认 → 删除（默认随之清空）', () => {
  const root = freshRoot()
  let s = upsertInterface(root, { name: '示例云端', kind: 'cloud', baseUrl: 'https://api.example.com/v1', defaultModel: 'image-model-x', models: ['image-model-x'] })
  assert.equal(s.interfaces.length, 1)
  const id = s.interfaces[0].id
  assert.equal(s.defaultInterface, '', '新增接口不会自动成为默认')

  s = writeSettings(root, { defaultInterface: id })
  assert.equal(s.defaultInterface, id)

  s = upsertInterface(root, { ...s.interfaces[0], name: '示例云端（改名）', models: ['image-model-x', 'image-model-y'] })
  assert.equal(s.interfaces[0].name, '示例云端（改名）')
  assert.equal(s.interfaces[0].models.length, 2)
  assert.equal(s.defaultInterface, id, '编辑不会丢掉默认接口')

  const removed = removeInterface(root, id)
  assert.equal(removed.settings.interfaces.length, 0)
  assert.equal(removed.settings.defaultInterface, '', '删掉默认接口后默认接口清空')
})

test('接口：本地 ComfyUI 归一化（默认地址、工作流槽位、超时）', () => {
  const s = normalizeInterface({ kind: 'local' })
  assert.equal(s.kind, 'local')
  assert.equal(s.baseUrl, 'http://127.0.0.1:8188')
  assert.deepEqual(s.comfy.workflows, { t2i: '', i2i: '', video: '' })
  assert.equal(s.comfy.timeoutMs, 900_000)
  const withWf = normalizeInterface({ kind: 'local', comfy: { workflows: { t2i: 'C:\\x.api.json' }, steps: 30 } })
  assert.equal(withWf.comfy.workflows.t2i, 'C:\\x.api.json')
  assert.equal(withWf.comfy.steps, 30)
})

test('接口：非法 URL 在 upsert 时抛错（不静默落盘）', () => {
  const root = freshRoot()
  assert.throws(() => upsertInterface(root, { name: 'x', kind: 'cloud', baseUrl: 'ftp://x' }), /不是合法 URL/)
  assert.equal(readSettings(root).interfaces.length, 0)
})

test('接口：非法 id 在 upsert 时被拒（不静默换成随机 id）', () => {
  const root = freshRoot()
  for (const bad of ['../evil', 'a b', 'x'.repeat(40), '中文id', 'a.b']) {
    assert.throws(() => upsertInterface(root, { id: bad, kind: 'cloud', baseUrl: 'https://a/v1' }), /接口 id 非法/)
  }
  assert.equal(readSettings(root).interfaces.length, 0, '被拒的接口一条也没落盘')
  // 合法的仍然能存；大写按小写归一
  const s = upsertInterface(root, { id: 'My-01', kind: 'cloud', baseUrl: 'https://a/v1' })
  assert.equal(s.interfaces[0].id, 'my-01')
})

test('接口：resolveInterface 的三种选择与报错', () => {
  const root = freshRoot()
  const base = { kind: 'cloud', baseUrl: 'https://a/v1', defaultModel: 'm' }
  // 0 个接口
  assert.match(resolveInterface(readSettings(root)).error, /还没有配置任何接口/)
  // 1 个接口没设默认 → 直接用
  let s = upsertInterface(root, base)
  assert.equal(resolveInterface(s).interface.id, s.interfaces[0].id)
  // 2 个接口没设默认 → 报「没有设定默认接口」
  s = upsertInterface(root, { ...base, name: '第二个' })
  assert.equal(s.interfaces.length, 2)
  assert.match(resolveInterface(s).error, /没有设定默认接口/)
  // 设了默认 → 用它；显式 id 优先
  const def = s.interfaces[1].id
  s = writeSettings(root, { defaultInterface: def })
  assert.equal(resolveInterface(s).interface.id, def)
  assert.equal(resolveInterface(s, s.interfaces[0].id).interface.id, s.interfaces[0].id)
  // 不存在的 id
  assert.match(resolveInterface(s, 'nope').error, /接口不存在/)
})

test('接口：describeInterfaces 标记默认与工作流，且不含密钥', () => {
  const root = freshRoot()
  let s = upsertInterface(root, { name: '本地', kind: 'local' })
  s = writeSettings(root, { defaultInterface: s.interfaces[0].id })
  const d = describeInterfaces(s)
  assert.equal(d.length, 1)
  assert.equal(d[0].isDefault, true)
  assert.equal(d[0].kindLabel, '本地 ComfyUI')
  assert.deepEqual(d[0].workflows, { t2i: '', i2i: '', video: '' })
  assert.equal(JSON.stringify(d).includes('key'), false)
})

test('normalizeSettings：类型错误不崩溃，重复 id 保持各自', () => {
  const s = normalizeSettings({ interfaces: [{ kind: 'cloud' }, { kind: 'local' }], defaultSize: 'abc', defaultCount: 'x' })
  assert.equal(s.interfaces.length, 2)
  assert.notEqual(s.interfaces[0].id, s.interfaces[1].id)
  assert.equal(s.defaultSize, DEFAULT_SETTINGS.defaultSize)
  assert.equal(s.defaultCount, DEFAULT_SETTINGS.defaultCount)
})

test('密钥：DPAPI 加密往返一致，文件不含明文', () => {
  const secret = 'sk-test-1234567890abcdef'
  const blob = encryptSecret(secret)
  assert.ok(blob.startsWith('DPAPI1:'))
  assert.ok(!blob.includes(secret), '密文里不能出现明文')
  assert.equal(decryptSecret(blob), secret)
})

test('密钥：每个接口一份文件，互不干扰；清除只影响本接口', () => {
  const root = freshRoot()
  const masked = saveKey(root, 'alpha', 'sk-abcdefghijklmnop')
  assert.ok(masked.endsWith('mnop'))
  assert.ok(fs.existsSync(keyPath(root, 'alpha')))
  assert.equal(keyPath(root, 'alpha'), path.join(keysDir(root), 'alpha.dat'))
  saveKey(root, 'beta', 'sk-second-2222')
  assert.equal(readStoredKey(root, 'alpha'), 'sk-abcdefghijklmnop')
  assert.equal(readStoredKey(root, 'beta'), 'sk-second-2222')
  assert.equal(hasStoredKey(root, 'alpha'), true)
  assert.equal(clearStoredKey(root, 'alpha'), true)
  assert.equal(readStoredKey(root, 'alpha'), '')
  assert.equal(readStoredKey(root, 'beta'), 'sk-second-2222', '别的接口密钥不受影响')
})

test('密钥：占位符与空值被拒；非法接口 id 被拒', () => {
  const root = freshRoot()
  assert.throws(() => saveKey(root, 'x', '   '), /不能为空/)
  assert.throws(() => saveKey(root, 'x', '<你的密钥>'), /占位符/)
  assert.throws(() => keyPath(root, '../evil'), /接口 id 非法/)
})

test('密钥：优先级 面板 > 环境变量；本地接口不需要密钥', () => {
  const root = freshRoot()
  const iface = { id: 'abc', kind: 'cloud', name: 'A' }
  const env = { [envNameFor('abc')]: 'sk-from-env-0001' }
  assert.equal(envNameFor('abc'), 'IMAGE_ASSETS_KEY_ABC')
  assert.equal(resolveApiKey(root, iface, env).source, 'env')
  saveKey(root, 'abc', 'sk-from-panel-0002')
  const r = resolveApiKey(root, iface, env)
  assert.equal(r.source, 'panel')
  assert.equal(r.key, 'sk-from-panel-0002')
  clearStoredKey(root, 'abc')
  assert.equal(resolveApiKey(root, iface, env).source, 'env')

  const local = { id: 'comfy', kind: 'local', name: '本地' }
  assert.equal(resolveApiKey(root, local, {}).source, 'not-needed')
  assert.equal(resolveApiKey(root, local, {}).key, '')
})

test('密钥：只有占位符时报占位符原因，不回落到网络请求', () => {
  const root = freshRoot()
  const r = resolveApiKey(root, { id: 'x', kind: 'cloud' }, { IMAGE_ASSETS_KEY_X: '<你的密钥>' })
  assert.equal(r.source, 'none')
  assert.match(r.error, /占位符/)
})

test('密钥：checkKey 与 maskKey 边界', () => {
  assert.equal(checkKey('').ok, false)
  assert.equal(checkKey('sk-real').ok, true)
  assert.equal(checkKey('nokey').warning.length > 0, true)
  assert.equal(maskKey(''), '')
  assert.equal(maskKey('short'), '••••')
})

test('迁移：v1 → v2 生成旧配置接口、密钥转成 per-interface、旧文件归档', () => {
  const root = freshRoot()
  fs.mkdirSync(path.dirname(settingsPath(root)), { recursive: true })
  fs.writeFileSync(settingsPath(root), JSON.stringify({
    version: 1, baseUrl: 'https://api.example.com/v1', defaultModel: 'image-model-x',
    defaultSize: '1024x1536', defaultCount: 2, timeoutMs: 300000,
  }), 'utf8')
  saveKey(root, 'seed', 'sk-legacy-1234') // 先保存一份密钥，再把它当成 v1 的组件
  const blob = fs.readFileSync(keyPath(root, 'seed'), 'utf8')
  fs.mkdirSync(path.dirname(path.join(path.dirname(settingsPath(root)), 'credentials.dat')), { recursive: true })
  fs.writeFileSync(path.join(path.dirname(settingsPath(root)), 'credentials.dat'), blob, 'utf8')
  assert.equal(readLegacyKey(root), 'sk-legacy-1234')

  const r = migrateIfNeeded(root)
  assert.equal(r.migrated, true)
  assert.equal(r.keyMigrated, true)
  assert.equal(resolveApiKey(root, { id: 'legacy', kind: 'cloud' }).key, 'sk-legacy-1234', '密钥迁到 per-interface 文件')
  assert.equal(fs.existsSync(path.join(path.dirname(settingsPath(root)), 'credentials.dat')), false, '旧密钥文件已归档')
  assert.ok(r.backups.settings, 'v1 settings 有备份')
  assert.ok(fs.existsSync(r.backups.settings))
  const s = readSettings(root)
  assert.equal(s.defaultInterface, '', '迁移后默认接口仍为空，等用户手动指定')
  assert.equal(s.defaultCount, 2, '其余 v1 字段保留')

  // 幂等：再跑一次不再迁移
  const again = migrateIfNeeded(root)
  assert.equal(again.migrated, false)
  assert.equal(readSettings(root).interfaces.length, 1)
})

test('迁移：解不开的旧密钥也归档，并给出重新填写的提示', () => {
  const root = freshRoot()
  fs.mkdirSync(path.dirname(settingsPath(root)), { recursive: true })
  fs.writeFileSync(settingsPath(root), JSON.stringify({ version: 1, baseUrl: 'https://a/v1', defaultModel: 'm' }), 'utf8')
  fs.writeFileSync(path.join(path.dirname(settingsPath(root)), 'credentials.dat'), 'DPAPI1:broken-not-base64', 'utf8')
  const r = migrateIfNeeded(root)
  assert.equal(r.migrated, true)
  assert.equal(r.keyMigrated, false)
  assert.ok(r.warnings.some((w) => w.includes('无法解密')))
  assert.equal(fs.existsSync(path.join(path.dirname(settingsPath(root)), 'credentials.dat')), false)
})
