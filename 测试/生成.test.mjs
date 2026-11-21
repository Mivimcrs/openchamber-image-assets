// 生成内核：尺寸校验、端点路由、错误映射、两种响应形态、透明背景只走文生图。

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  validateSize, endpointFor, mapHttpError, requestImages, SIZE_PRESETS, MAX_COUNT,
} from '../源码/共享/生成.js'

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'),
  Buffer.from([0, 0, 4, 0, 0, 0, 6, 0]), Buffer.alloc(5),
])

const realFetch = globalThis.fetch
test.after(() => { globalThis.fetch = realFetch })

test('尺寸：合法保留，非法/超范围回落', () => {
  assert.equal(validateSize('1024x1536'), '1024x1536')
  assert.equal(validateSize(' 2048X2048 '), '2048x2048')
  assert.equal(validateSize('999'), '1024x1536')
  assert.equal(validateSize('100x100'), '1024x1536')
  assert.equal(validateSize('9999x9999'), '1024x1536')
  assert.equal(validateSize(undefined, '1536x1024'), '1536x1024')
})

test('预设尺寸都通过校验且形态正确', () => {
  for (const p of SIZE_PRESETS) assert.equal(validateSize(p.size), p.size, p.label)
})

test('端点路由：有参考图走 edits，无参考图走 generations', () => {
  assert.equal(endpointFor([]), '/images/generations')
  assert.equal(endpointFor([{ bytes: PNG }]), '/images/edits')
})

test('错误映射：状态码是唯一信息来源', () => {
  assert.match(mapHttpError(400, '/images/edits', ''), /400/)
  assert.match(mapHttpError(401, '/images/generations', ''), /密钥被拒绝/)
  assert.match(mapHttpError(404, '/images/generations', ''), /接口不存在/)
  assert.match(mapHttpError(503, '/images/generations', 'No available channel'), /上游失败/)
  assert.match(mapHttpError(503, '/images/generations', ''), /响应体为空/)
})

test('文生图：JSON body、无 response_format、透明参数只在文生图出现', async () => {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    if (String(url).endsWith('/images/generations')) {
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }], usage: { total_tokens: 10 } }),
      }
    }
    throw new Error('意外请求 ' + url)
  }

  const out = await requestImages({
    baseUrl: 'https://api.example.com/v1/', apiKey: 'sk-x', model: 'm', prompt: 'p', size: '1024x1536', count: 2, transparent: true,
  })
  const body = JSON.parse(calls[0].init.body)
  assert.equal(calls[0].url, 'https://api.example.com/v1/images/generations')
  assert.equal(body.response_format, undefined)
  assert.equal(body.n, 2)
  assert.equal(body.background, 'transparent')
  assert.equal(body.output_format, 'png')
  assert.equal(out.endpoint, '/images/generations')
  assert.equal(out.results.length, 1)
  assert.equal(out.usage.total_tokens, 10)
  assert.equal(out.warnings.length, 0)
})

test('参考图生图：multipart 带 image 字段，透明参数不下发但给提示', async () => {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    if (String(url).endsWith('/images/edits')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ b64_json: PNG.toString('base64') }] }) }
    }
    throw new Error('意外请求 ' + url)
  }

  const out = await requestImages({
    baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x', model: 'm', prompt: '保留主体，只换背景',
    size: '1024x1536', count: 1, transparent: true,
    images: [
      { bytes: PNG, name: 'a.png', mime: 'image/png' },
      { bytes: PNG, name: 'b.jpg', mime: 'image/jpeg' },
    ],
  })
  assert.equal(calls[0].url, 'https://api.example.com/v1/images/edits')
  const fd = calls[0].init.body
  assert.equal(fd.get('model'), 'm')
  assert.equal(fd.get('prompt'), '保留主体，只换背景')
  assert.equal(fd.getAll('image').length, 2)
  assert.equal(fd.get('background'), null)
  assert.equal(out.endpoint, '/images/edits')
  assert.ok(out.warnings.some((w) => w.includes('透明背景')))
})

test('URL 模式：接口返回 URL 时下载字节', async () => {
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/images/generations')) {
      return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ url: 'https://cdn.example.com/a.png' }] }) }
    }
    if (String(url).startsWith('https://cdn.example.com/')) {
      return { ok: true, status: 200, arrayBuffer: async () => PNG }
    }
    throw new Error('意外请求 ' + url)
  }
  const out = await requestImages({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x', model: 'm', prompt: 'p', size: '1024x1024' })
  assert.equal(out.results[0].mode, 'url')
  assert.equal(Buffer.compare(out.results[0].bytes, PNG), 0)
})

test('失败：HTTP 错误只抛一次，不重试', async () => {
  let n = 0
  globalThis.fetch = async () => { n++; return { ok: false, status: 503, text: async () => '' } }
  await assert.rejects(
    () => requestImages({ baseUrl: 'https://api.example.com/v1', apiKey: 'sk-x', model: 'm', prompt: 'p' }),
    /上游失败/,
  )
  assert.equal(n, 1)
})

test('校验：空提示词 / 空密钥 / 超张数', async () => {
  await assert.rejects(() => requestImages({ baseUrl: 'https://a/v1', apiKey: 'k', model: 'm', prompt: '  ' }), /提示词不能为空/)
  await assert.rejects(() => requestImages({ baseUrl: 'https://a/v1', apiKey: '', model: 'm', prompt: 'p' }), /密钥未配置/)
  await assert.rejects(
    () => requestImages({
      baseUrl: 'https://a/v1', apiKey: 'k', model: 'm', prompt: 'p',
      images: Array.from({ length: MAX_COUNT + 1 }, () => ({ bytes: PNG, name: 'a.png' })),
    }),
    /最多/,
  )
})
