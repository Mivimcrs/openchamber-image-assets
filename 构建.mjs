// 构建脚本（esbuild 与 @openchamber/sdk 装在仓库外的构建环境里，用 IMAGE_ASSETS_BUILD_ENV 指定）：
//   1) 把 源码/共享/*.js 同步到 plugin/shared/（插件自包含）
//   2) 校验 工作流/*.api.json（运行期按扩展根找模板，宿主更新会整份替换）
//   3) 打包 service/main.js（node ESM，内联 @openchamber/sdk）
//   4) 打包 panel/main.js（浏览器 IIFE，内联 @openchamber/sdk）
// 用法：IMAGE_ASSETS_BUILD_ENV=<装了依赖的目录> node 构建.mjs

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const HERE = path.dirname(fileURLToPath(import.meta.url))
// 默认找仓库根下的 .build-env（已进 .gitignore）：在里面 npm i esbuild @openchamber/sdk 即可
const IDE_ENV = process.env.IMAGE_ASSETS_BUILD_ENV || path.join(HERE, '.build-env')
if (!fs.existsSync(path.join(IDE_ENV, 'node_modules'))) {
  throw new Error(`找不到构建环境的 node_modules：${IDE_ENV}。请用 IMAGE_ASSETS_BUILD_ENV 指定，或在 .build-env 里安装 esbuild 与 @openchamber/sdk`)
}
const require = createRequire(path.join(IDE_ENV, 'package.json'))
const esbuild = require('esbuild')

const sharedSrc = path.join(HERE, '源码', '共享')
const sharedOut = path.join(HERE, 'plugin', 'shared')

// 1) 同步插件共享逻辑
fs.mkdirSync(sharedOut, { recursive: true })
for (const name of fs.readdirSync(sharedSrc)) {
  if (name.endsWith('.js')) fs.copyFileSync(path.join(sharedSrc, name), path.join(sharedOut, name))
}
console.log('[build] shared → plugin/shared:', fs.readdirSync(sharedOut).join(', '))

// 2) 工作流模板必须随仓库走（安装目录里的手改会被更新覆盖）
const wfDir = path.join(HERE, '工作流')
if (fs.existsSync(wfDir)) {
  const tpls = fs.readdirSync(wfDir).filter((n) => n.endsWith('.api.json'))
  for (const name of tpls) {
    const src = path.join(wfDir, name)
    const parsed = JSON.parse(fs.readFileSync(src, 'utf8'))
    const nodes = Object.keys(parsed).length
    if (!nodes) throw new Error(`[build] 工作流模板没有节点：${name}`)
    console.log(`[build] 工作流模板：${name}（${nodes} 节点）`)
  }
} else {
  console.warn('[build] 没有 工作流/ 目录：本地 ComfyUI 只能用接口里指定的自定义模板路径')
}

const nodePaths = [path.join(IDE_ENV, 'node_modules')]
// esbuild 会把源文件的绝对路径写进产物注释（commonjs 模块的 // <path> 行）。
// 用相对路径 + ASCII 目录名，避免公开仓库里出现本机路径。
const BUILD_CWD = fs.mkdtempSync(path.join(os.tmpdir(), 'image-assets-build-'))
fs.mkdirSync(path.join(BUILD_CWD, 'deps'), { recursive: true })
for (const dep of ['@openchamber']) {
  const src = path.join(IDE_ENV, 'node_modules', dep)
  if (fs.existsSync(src)) fs.cpSync(src, path.join(BUILD_CWD, 'deps', dep), { recursive: true, dereference: true })
}
nodePaths.length = 0
nodePaths.push(path.join(BUILD_CWD, 'deps'))
process.chdir(BUILD_CWD)

// 2) service（node，内联 SDK）
await esbuild.build({
  entryPoints: [path.join(HERE, '源码', 'service', 'main.js')],
  outfile: path.join(HERE, 'service', 'main.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  nodePaths,
  absWorkingDir: BUILD_CWD,
  logLevel: 'info',
})

// 3) panel（浏览器 IIFE，内联 SDK）
await esbuild.build({
  entryPoints: [path.join(HERE, '源码', 'panel', 'main.js')],
  outfile: path.join(HERE, 'panel', 'main.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  nodePaths,
  absWorkingDir: BUILD_CWD,
  logLevel: 'info',
})

try { process.chdir(HERE) } catch { /* 忽略 */ }
try { fs.rmSync(BUILD_CWD, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }) } catch { /* 临时目录清不掉不影响产物 */ }
console.log('[build] 完成')
