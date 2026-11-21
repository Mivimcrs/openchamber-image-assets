// 本地 ComfyUI 客户端与模板打桩单测（不联网、不依赖 ComfyUI 进程）。

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  aspectForSize, randomSeed, patchTemplate, COMFY_ASPECTS, DEFAULT_COMFY_URL,
} from '../源码/共享/ComfyUI.js'
import { loadTemplate, templatePath, describeTemplate, BUNDLED, SLOTS } from '../源码/共享/工作流.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXT_ROOT = path.join(HERE, '..')
const TMP_ROOT = path.join(os.tmpdir(), '生图扩展测试')

// 扩展自带的一份最小 API 模板形状（与真实 t2i 模板同类节点）
function miniTemplate() {
  return {
    '9': { class_type: 'SaveImage', inputs: { filename_prefix: 'moss', images: ['18:8', 0] } },
    '19': { class_type: 'ResolutionSelector', inputs: { aspect_ratio: '1:1 (Square)', megapixels: 1, multiple: 16 } },
    '18:17': { class_type: 'PrimitiveStringMultiline', inputs: { value: '示例提示词' } },
    '18:14': { class_type: 'PrimitiveStringMultiline', inputs: { value: '系统扩写提示词' } },
    '18:11': { class_type: 'TextGenerate', inputs: { prompt: ['18:17', 0], system_prompt: ['18:14', 0] } },
    '18:5': { class_type: 'CLIPTextEncode', inputs: { text: 'nsfw, low quality', clip: ['18:2', 0] } },
    '18:4': { class_type: 'CLIPTextEncode', inputs: { text: ['18:13', 0], clip: ['18:2', 0] } },
    '18:7': { class_type: 'KSampler', inputs: { seed: 1, steps: 25, cfg: 2.5, sampler_name: 'er_sde', scheduler: 'simple', denoise: 1, model: ['18:24', 0], positive: ['18:4', 0], negative: ['18:5', 0], latent_image: ['18:6', 0] } },
    '18:1': { class_type: 'UNETLoader', inputs: { unet_name: 'moss_image_sft.safetensors', weight_dtype: 'default' } },
    '18:2': { class_type: 'CLIPLoader', inputs: { clip_name: 'qwen3.5.safetensors', type: 'moss_image', device: 'default' } },
    '18:3': { class_type: 'VAELoader', inputs: { vae_name: 'flux2-vae.safetensors' } },
  }
}

test('aspectForSize：常见画幅映射到 ResolutionSelector 的取值与总像素', () => {
  assert.equal(aspectForSize('1024x1024').aspect, '1:1 (Square)')
  assert.equal(aspectForSize('1024x1536').aspect, '2:3 (Portrait Photo)')
  const a = aspectForSize('1024x1536')
  assert.ok(Math.abs(a.megapixels - 1.5) < 0.02, `1.5MP 左右，实际 ${a.megapixels}`)
  assert.equal(aspectForSize('1536x864').aspect, '16:9 (Widescreen)')
  assert.equal(aspectForSize('864x1536').aspect, '9:16 (Portrait Widescreen)')
  // 非法输入回落到 1:1
  assert.equal(aspectForSize('abc').aspect, '1:1 (Square)')
  assert.equal(aspectForSize('').megapixels, 1)
  // megapixels 被夹在 [0.1, 16]
  assert.ok(aspectForSize('4096x4096').megapixels <= 16)
  assert.equal(COMFY_ASPECTS.length, 8)
})

test('randomSeed：落在安全整数区间，且每次不同', () => {
  const a = randomSeed()
  const b = randomSeed()
  assert.ok(Number.isInteger(a) && a > 0 && a < 2 ** 52)
  assert.notEqual(a, b)
})

test('patchTemplate：提示词只改第一个 PrimitiveString（用户槽），不动系统扩写提示词', () => {
  const { template, warnings } = patchTemplate(miniTemplate(), { prompt: '新的用户提示词' })
  assert.equal(template['18:17'].inputs.value, '新的用户提示词')
  assert.equal(template['18:14'].inputs.value, '系统扩写提示词', '系统提示词不能被覆盖')
  assert.deepEqual(warnings, [])
})

test('patchTemplate：反向提示词只改纯字符串的 CLIPTextEncode', () => {
  const { template } = patchTemplate(miniTemplate(), { negative: 'bad hands' })
  assert.equal(template['18:5'].inputs.text, 'bad hands')
  assert.deepEqual(template['18:4'].inputs.text, ['18:13', 0], '连线节点不动')
})

test('patchTemplate：采样参数、尺寸、模型名、输出前缀都按需替换', () => {
  const patch = {
    prompt: 'x', size: '1024x1536', seed: 42, steps: 30, cfg: 3,
    sampler: 'euler', scheduler: 'karras', unet: 'moss-lora.safetensors',
    vae: 'v2.safetensors', prefix: 'openchamber/t2i',
  }
  const { template } = patchTemplate(miniTemplate(), patch)
  assert.equal(template['18:7'].inputs.seed, 42)
  assert.equal(template['18:7'].inputs.steps, 30)
  assert.equal(template['18:7'].inputs.cfg, 3)
  assert.equal(template['18:7'].inputs.sampler_name, 'euler')
  assert.equal(template['18:7'].inputs.scheduler, 'karras')
  assert.equal(template['18:1'].inputs.unet_name, 'moss-lora.safetensors')
  assert.equal(template['18:3'].inputs.vae_name, 'v2.safetensors')
  assert.equal(template['19'].inputs.aspect_ratio, '2:3 (Portrait Photo)')
  assert.equal(template['19'].inputs.megapixels, 1.5)
  assert.equal(template['9'].inputs.filename_prefix, 'openchamber/t2i')
  // 原模板不被修改（深拷贝）
  assert.equal(miniTemplate()['18:7'].inputs.seed, 1)
})

test('patchTemplate：空值/非法值不覆盖模板里的原值', () => {
  const base = miniTemplate()
  const { template } = patchTemplate(base, { prompt: '   ', negative: undefined, steps: 'abc', cfg: '' })
  assert.equal(template['18:17'].inputs.value, '示例提示词')
  assert.equal(template['18:7'].inputs.steps, 25)
  assert.equal(template['18:7'].inputs.cfg, 2.5)
})

test('patchTemplate：参考图接到 TextGenerate 的 image 槽；模板缺 LoadImage 时给提示', () => {
  const tpl = miniTemplate()
  tpl['100'] = { class_type: 'LoadImage', inputs: { image: 'x.png' } }
  const { template } = patchTemplate(tpl, { prompt: 'x', imageName: 'openchamber/ref.png' })
  assert.equal(template['100'].inputs.image, 'openchamber/ref.png')
  assert.deepEqual(template['18:11'].inputs.image, ['100', 0])

  const noLoad = patchTemplate(miniTemplate(), { prompt: 'x', imageName: 'openchamber/ref.png' })
  assert.match(noLoad.warnings.join('；'), /没有 LoadImage/)
})

test('patchTemplate：模板没有 LoRA 节点时 lora 参数给 warning 而不是崩', () => {
  const { warnings } = patchTemplate(miniTemplate(), { lora: 'x.safetensors' })
  assert.ok(warnings.some((w) => w.includes('LoRA')))
})

// ---- 模板加载 ----

test('工作流：扩展自带 t2i / i2i 模板可加载，节点里有 SaveImage', () => {
  for (const slot of ['t2i', 'i2i']) {
    const t = loadTemplate(EXT_ROOT, slot)
    assert.ok(t.template, `${slot} 模板应能读取`)
    assert.equal(t.source, 'bundled')
    const classes = Object.values(t.template).map((n) => n.class_type)
    assert.ok(classes.includes('SaveImage'))
    if (slot === 'i2i') assert.ok(classes.includes('LoadImage'), 'i2i 模板应含 LoadImage')
  }
})

test('工作流：video 无自带模板 → 明确报错让用户填路径', () => {
  assert.equal(BUNDLED.video, '')
  assert.throws(() => loadTemplate(EXT_ROOT, 'video'), /还没有配置视频工作流/)
})

test('工作流：自定义路径优先；文件不存在/坏 JSON 报错', () => {
  fs.mkdirSync(TMP_ROOT, { recursive: true })
  const good = path.join(TMP_ROOT, `tpl-${Date.now()}.json`)
  fs.writeFileSync(good, JSON.stringify(miniTemplate()), 'utf8')
  const t = loadTemplate(EXT_ROOT, 't2i', good)
  assert.equal(t.source, 'custom')
  assert.equal(t.path, good)

  const resolved = templatePath(EXT_ROOT, 't2i', path.join(TMP_ROOT, 'nope.json'))
  assert.equal(resolved.source, 'custom')
  assert.equal(resolved.exists, false)
  assert.throws(() => loadTemplate(EXT_ROOT, 't2i', resolved.path), /模板文件不存在/)

  const bad = path.join(TMP_ROOT, `bad-${Date.now()}.json`)
  fs.writeFileSync(bad, '{not json', 'utf8')
  assert.throws(() => loadTemplate(EXT_ROOT, 't2i', bad), /无法解析/)

  const noOutput = path.join(TMP_ROOT, `noout-${Date.now()}.json`)
  fs.writeFileSync(noOutput, JSON.stringify({ '1': { class_type: 'KSampler', inputs: {} } }), 'utf8')
  assert.throws(() => loadTemplate(EXT_ROOT, 't2i', noOutput), /没有 SaveImage/)
})

test('工作流：describeTemplate 汇总节点数与类名，缺失时带 error', () => {
  const d = describeTemplate(EXT_ROOT, 't2i')
  assert.equal(d.exists, true)
  assert.ok(d.nodes > 5)
  assert.ok(d.classes.includes('KSampler'))
  const missing = describeTemplate(EXT_ROOT, 'video')
  assert.equal(missing.exists, false)
  assert.ok(missing.error)
  assert.deepEqual(SLOTS, ['t2i', 'i2i', 'video'])
})

test('默认地址常量正确（本地 ComfyUI 端口）', () => {
  assert.equal(DEFAULT_COMFY_URL, 'http://127.0.0.1:8188')
})
