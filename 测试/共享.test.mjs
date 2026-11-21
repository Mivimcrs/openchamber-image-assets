// 共享逻辑单测：密钥校验、图片头解析、模型清单、回退决策、资产库 CRUD。
// 临时文件一律落在系统临时目录 os.tmpdir() 下。

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { checkKey, sniffImage, modelsInclude, pickImageModels, shouldFallbackToUrl, failureReport } from '../源码/共享/校验.js'
import {
  ensureLibrary, scanAssets, saveAsset, findAsset, annotateAsset,
  deleteAsset, filterAssets, makeAssetId, libraryPaths, NOTE_MAX,
  moveLibrary, pendingMove,
} from '../源码/共享/资产库.js'

const TMP_ROOT = path.join(os.tmpdir(), '生图扩展测试')

function makeTempLibrary() {
  fs.mkdirSync(TMP_ROOT, { recursive: true })
  return fs.mkdtempSync(path.join(TMP_ROOT, 'lib-'))
}

function pngBytes(w = 1024, h = 1536) {
  const b = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8); b.write('IHDR', 12)
  b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20)
  return b
}

function jpgBytes(w = 800, h = 600) {
  return Buffer.from([
    0xff, 0xd8,                                   // SOI
    0xff, 0xe0, 0x00, 0x10, ...Buffer.alloc(14),  // APP0
    0xff, 0xc0, 0x00, 0x0b, 0x08,                 // SOF0, len=11, precision=8
    (h >> 8) & 0xff, h & 0xff, (w >> 8) & 0xff, w & 0xff,
    0x01, 0x11, 0x00,
  ])
}

// ---- 校验 ----

test('checkKey：空值与占位符拒绝，真实密钥通过', () => {
  assert.equal(checkKey('').ok, false)
  assert.equal(checkKey(null).ok, false)
  assert.equal(checkKey('<你的密钥>').ok, false)
  assert.equal(checkKey('sk-<placeholder>').ok, false)
  assert.equal(checkKey('sk-cynabcdef').ok, true)
  assert.equal(checkKey('abcdef').ok, true) // 非 sk- 仅警告不阻断
})

test('sniffImage：PNG 与 JPEG 头解析出宽高', () => {
  assert.deepEqual(sniffImage(pngBytes(1024, 1536)), { type: 'png', width: 1024, height: 1536 })
  assert.deepEqual(sniffImage(jpgBytes(800, 600)), { type: 'jpg', width: 800, height: 600 })
})

test('sniffImage：垃圾数据与截断数据返回 null', () => {
  assert.equal(sniffImage(Buffer.from('not an image at all!!')), null)
  assert.equal(sniffImage(pngBytes().subarray(0, 16)), null)
  assert.equal(sniffImage(null), null)
  // PNG 魔数对但缺 IHDR
  const badPng = Buffer.alloc(32); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(badPng)
  assert.equal(sniffImage(badPng), null)
})

test('modelsInclude / pickImageModels：兼容 data 数组与顶层数组', () => {
  const payload = { data: [{ id: 'gpt-image-2.6-sunburst' }, { id: 'grok-imagine-image-2.0' }, { id: 'glm-4.6' }] }
  assert.equal(modelsInclude(payload, 'gpt-image-2.6-sunburst'), true)
  assert.equal(modelsInclude(payload, 'nope'), false)
  assert.equal(modelsInclude(['a', 'b'], 'b'), true)
  const imgs = pickImageModels(payload)
  assert.ok(imgs.includes('gpt-image-2.6-sunburst'))
  assert.ok(imgs.includes('grok-imagine-image-2.0'))
  assert.ok(!imgs.includes('glm-4.6'))
})

test('shouldFallbackToUrl：仅参数类错误回退，503/额度不回退', () => {
  assert.equal(shouldFallbackToUrl('response_format is not supported'), true)
  assert.equal(shouldFallbackToUrl('unknown parameter response_format'), true)
  assert.equal(shouldFallbackToUrl('unexpected keyword argument: response_format'), true)
  assert.equal(shouldFallbackToUrl('503 No available channel'), false)
  assert.equal(shouldFallbackToUrl('insufficient quota'), false)
  assert.equal(shouldFallbackToUrl('invalid api key'), false)
  assert.equal(shouldFallbackToUrl(''), false)
})

test('failureReport：包含单次纪律指令', () => {
  const r = failureReport('生成', '503')
  assert.ok(r.includes('生成'))
  assert.ok(r.includes('不要自动重试'))
  assert.ok(r.includes('经用户确认'))
})

// ---- 资产库 ----

test('资产库：入库→扫描→查找→标注→删除 完整闭环', () => {
  const root = makeTempLibrary()
  ensureLibrary(root)
  const p = libraryPaths(root)
  assert.ok(fs.existsSync(p.images) && fs.existsSync(p.index) && fs.existsSync(p.runtime))

  const rec = saveAsset(root, pngBytes(1024, 1536), {
    sessionId: 'ses_test', sessionTitle: '测试会话', projectDirectory: 'D:/proj',
    prompt: '普拉提馆镜面', model: 'gpt-image-2.6-sunburst', apiSize: '1024x1536',
    tags: ['普拉提', '镜面 '], note: '初版',
  })
  assert.ok(rec.id)
  assert.ok(rec.file.startsWith('图片' + path.sep) || rec.file.startsWith('图片/'))
  assert.equal(rec.width, undefined) // 宽高由调用方解析后传入或后补，此处不校验
  assert.deepEqual(rec.tags, ['普拉提', '镜面']) // trim 生效

  const scanned = scanAssets(root)
  assert.equal(scanned.assets.length, 1)
  assert.equal(scanned.warnings.length, 0)

  const found = findAsset(root, rec.id)
  assert.equal(found.prompt, '普拉提馆镜面')

  const updated = annotateAsset(root, rec.id, { tags: ['定稿'], note: '客户确认' })
  assert.deepEqual(updated.tags, ['定稿'])
  assert.equal(updated.note, '客户确认')

  const filtered = filterAssets(scanAssets(root).assets, { sessionId: 'ses_test', q: '客户' })
  assert.equal(filtered.length, 1)
  assert.equal(filterAssets(scanAssets(root).assets, { sessionId: 'other' }).length, 0)

  const del = deleteAsset(root, rec.id)
  assert.equal(del.deleted, true)
  assert.equal(scanAssets(root).assets.length, 0)
  assert.ok(!fs.existsSync(path.join(root, rec.file)), '图片文件应已删除')
})

test('资产库：图片头不符的 .bin 也入库但文件保留原字节', () => {
  const root = makeTempLibrary()
  const junk = Buffer.from('hello-not-an-image')
  const rec = saveAsset(root, junk, { prompt: 'x', sessionId: 's' })
  assert.ok(rec.file.endsWith('.bin'))
  assert.deepEqual(fs.readFileSync(path.join(root, rec.file)), junk)
})

test('资产库：坏记录进 warnings 不炸扫描；越界 file 拒绝', () => {
  const root = makeTempLibrary()
  ensureLibrary(root)
  const { index } = libraryPaths(root)
  fs.writeFileSync(path.join(index, 'bad1.json'), '{not json', 'utf8')
  fs.writeFileSync(path.join(index, 'bad2.json'), JSON.stringify({ id: 'bad2', file: '../逃逸.png' }), 'utf8')
  fs.writeFileSync(path.join(index, 'bad3.json'), JSON.stringify({ id: 'bad3', file: '图片/不存在.png' }), 'utf8')
  const { assets, warnings } = scanAssets(root)
  assert.equal(assets.length, 0)
  assert.equal(warnings.length, 3)
})

test('annotateAsset：非法 id 与不存在资产报错；note 超长截断', () => {
  const root = makeTempLibrary()
  assert.throws(() => annotateAsset(root, '../evil', {}), /不存在/)
  assert.throws(() => annotateAsset(root, 'nope', {}), /不存在/)
  const rec = saveAsset(root, pngBytes(10, 10), { prompt: 'x' })
  const up = annotateAsset(root, rec.id, { note: 'a'.repeat(NOTE_MAX + 100) })
  assert.equal(up.note.length, NOTE_MAX)
})

test('deleteAsset：不存在资产报错；id 形态非法 find 返回 null', () => {
  const root = makeTempLibrary()
  assert.throws(() => deleteAsset(root, 'missing'), /不存在/)
  assert.equal(findAsset(root, '../../etc/passwd'), null)
})

test('makeAssetId：形如 base36 时间戳-随机串，且唯一', () => {
  const a = makeAssetId(1794296399962, 0.5)
  const b = makeAssetId(1794296399962, 0.5001)
  assert.notEqual(a, b)
  assert.match(a, /^[0-9a-z]+-[0-9a-z]+$/)
})

// ---- 整库搬迁 ----

function seedLibrary(root, count = 2) {
  ensureLibrary(root)
  for (let i = 0; i < count; i += 1) {
    saveAsset(root, pngBytes(64 + i, 64), { prompt: `p${i}`, sessionId: 's1' })
  }
  return root
}

test('moveLibrary：整库搬过去，源库改名为归档目录，目标可用且资产数一致', () => {
  const src = seedLibrary(makeTempLibrary(), 2)
  const dst = path.join(path.dirname(src), path.basename(src) + '-moved')
  assert.equal(scanAssets(src).assets.length, 2)

  const res = moveLibrary(src, dst, { now: 1794296399962 })
  assert.equal(res.action, 'moved')
  assert.equal(res.files > 0, true)
  assert.equal(fs.existsSync(src), false, '源库已被改名归档')
  assert.equal(fs.existsSync(res.backup), true, '归档目录还在（先归档不删）')
  assert.equal(scanAssets(dst).assets.length, 2, '目标库内容完整')
  assert.equal(pendingMove(dst), null, '完成后不留搬迁标记')
  assert.equal(scanAssets(src).assets.length, 0) // 源路径已不存在
  assert.equal(fs.existsSync(path.join(dst, '索引')), true)
})

test('moveLibrary：keepSource 时源库原地保留', () => {
  const src = seedLibrary(makeTempLibrary(), 1)
  const dst = path.join(path.dirname(src), path.basename(src) + '-copy')
  const res = moveLibrary(src, dst, { keepSource: true })
  assert.equal(fs.existsSync(src), true)
  assert.equal(res.backup, src)
  assert.equal(scanAssets(dst).assets.length, 1)
})

test('moveLibrary：拒绝目标已有别的库、目标在源库内、源不存在', () => {
  const src = seedLibrary(makeTempLibrary(), 1)
  const dst = seedLibrary(makeTempLibrary(), 1) // 已有内容
  assert.throws(() => moveLibrary(src, dst), /已经有资产库/)
  assert.throws(() => moveLibrary(src, path.join(src, 'nested')), /里面/)
  assert.throws(() => moveLibrary(path.join(src, 'nope'), dst), /源库不存在/)
})

test('moveLibrary：目标里有未完成标记时，只允许同一来源续传', () => {
  const src = seedLibrary(makeTempLibrary(), 1)
  const dst = path.join(path.dirname(src), path.basename(src) + '-resume')
  fs.mkdirSync(path.join(dst, '.搬家中'), { recursive: true })
  fs.writeFileSync(
    path.join(dst, '.搬家中', 'move.json'),
    JSON.stringify({ version: 1, from: src, to: dst, startedAt: 1 }),
    'utf8',
  )
  const res = moveLibrary(src, dst)
  assert.equal(res.action, 'resumed')
  assert.equal(scanAssets(dst).assets.length, 1)
  assert.equal(pendingMove(dst), null)
})

test('moveLibrary：目标标记来自另一个源时拒绝，避免把两份数据混在一起', () => {
  const other = seedLibrary(makeTempLibrary(), 1)
  const dst = makeTempLibrary()
  fs.mkdirSync(path.join(dst, '.搬家中'), { recursive: true })
  fs.writeFileSync(
    path.join(dst, '.搬家中', 'move.json'),
    JSON.stringify({ version: 1, from: path.join(dst, 'elsewhere'), to: dst, startedAt: 1 }),
    'utf8',
  )
  assert.throws(() => moveLibrary(other, dst), /未完成的搬迁标记/)
})

test('pendingMove：没有标记时返回 null，有标记时给出源与目标', () => {
  const root = makeTempLibrary()
  assert.equal(pendingMove(root), null)
  fs.mkdirSync(path.join(root, '.搬家中'), { recursive: true })
  fs.writeFileSync(path.join(root, '.搬家中', 'move.json'), JSON.stringify({ from: '/a', to: root, startedAt: 5 }), 'utf8')
  assert.deepEqual(pendingMove(root), { from: '/a', to: root, startedAt: 5 })
})

test.after(() => {
  // 这里只清理自己造的临时库；TMP_ROOT 是多文件共用的，别的测试进程还在用，不能整目录删。
})
