// 共享纯逻辑：接口密钥的本机加密存取（Windows DPAPI，绑定当前用户）。
//
// 存储形态：配置\密钥\<接口id>.dat，内容为 "DPAPI1:<base64>"。每个接口一份，互不影响。
// - 明文只经子进程 stdin 传递，绝不出现在命令行参数（进程列表可见）里
// - 解密结果只在本进程内存里用，不写日志、不回传给面板
// - 面板只能拿到脱敏后的末 4 位
//
// 解析顺序（per interface）：面板保存的 DPAPI 密文 > 环境变量 IMAGE_ASSETS_KEY_<接口ID 大写>
// 新装不带任何预置服务商或预置密钥（旧版 credentials.dat 迁移时归档，见 迁移.js）。
//
// 只依赖 node:fs / node:path / node:child_process。

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { keysDir, configDir, legacyCredentialsPath } from './配置.js'

const PREFIX = 'DPAPI1:'
const PLACEHOLDER_RE = /^<|你的密钥|REPLACE|sk-xxx|changeme|placeholder/i

const PS_PROTECT = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName System.Security',
  '$b64=[Console]::In.ReadToEnd().Trim()',
  'if([string]::IsNullOrWhiteSpace($b64)){exit 2}',
  '$bytes=[Convert]::FromBase64String($b64)',
  '$enc=[System.Security.Cryptography.ProtectedData]::Protect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($enc))',
].join('; ')

const PS_UNPROTECT = [
  "$ErrorActionPreference='Stop'",
  'Add-Type -AssemblyName System.Security',
  '$b64=[Console]::In.ReadToEnd().Trim()',
  'if([string]::IsNullOrWhiteSpace($b64)){exit 2}',
  '$bytes=[Convert]::FromBase64String($b64)',
  '$dec=[System.Security.Cryptography.ProtectedData]::Unprotect($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($dec))',
].join('; ')

function runPowerShell(script, stdinText) {
  // 只用 -Command：-EncodedCommand 在部分环境里拿不到 stdout。
  // 明文/密文走 stdin，脚本本身不含任何机密，可以放在命令行里。
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input: stdinText,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  })
  if (r.error) throw new Error(`PowerShell 调用失败：${r.error.message}`)
  if (r.status !== 0) {
    const detail = String(r.stderr || '').trim().split(/\r?\n/).slice(0, 2).join(' ')
    throw new Error(`DPAPI 操作失败（exit ${r.status}）${detail ? '：' + detail.slice(0, 200) : ''}`)
  }
  const out = String(r.stdout || '').trim()
  if (!out) throw new Error('DPAPI 返回空结果')
  return out
}

/** 明文 → DPAPI 密文串（DPAPI1:base64）。 */
export function encryptSecret(plain) {
  const b64 = Buffer.from(String(plain), 'utf8').toString('base64')
  return PREFIX + runPowerShell(PS_PROTECT, b64)
}

/** DPAPI 密文串 → 明文；格式不对或解密失败抛错。 */
export function decryptSecret(blob) {
  const s = String(blob || '').trim()
  if (!s.startsWith(PREFIX)) throw new Error('密文格式不认识（应以 DPAPI1: 开头）')
  const b64 = runPowerShell(PS_UNPROTECT, s.slice(PREFIX.length))
  return Buffer.from(b64, 'base64').toString('utf8')
}

/** 某接口的密文文件路径。接口 id 出现非法字符直接拒绝，不做静默清洗（避免 ../evil → evil 这种越界误导）。 */
export function keyPath(root, id) {
  const raw = String(id || '').trim()
  if (!raw || !/^[A-Za-z0-9_-]{1,24}$/.test(raw)) throw new Error('接口 id 非法（只允许字母、数字、下划线与连字符）')
  return path.join(keysDir(root), `${raw.toLowerCase()}.dat`)
}

/** 该接口对应的环境变量名。 */
export function envNameFor(id) {
  return `IMAGE_ASSETS_KEY_${String(id || '').toUpperCase().replace(/[^A-Z0-9_-]/g, '')}`
}

/** 保存某接口的密钥（原子写）。返回脱敏串。 */
export function saveKey(root, id, plain) {
  const value = typeof plain === 'string' ? plain.trim() : ''
  if (!value) throw new Error('密钥不能为空')
  if (PLACEHOLDER_RE.test(value)) throw new Error('这看起来是占位符，不是真实密钥')
  const blob = encryptSecret(value)
  const target = keyPath(root, id)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const tmp = `${target}.tmp`
  fs.writeFileSync(tmp, blob, 'utf8')
  fs.renameSync(tmp, target)
  return maskKey(value)
}

/** 读取某接口面板保存的密钥；没有或解不开返回空串（不抛错，方便回落）。 */
export function readStoredKey(root, id) {
  let blob
  try {
    blob = fs.readFileSync(keyPath(root, id), 'utf8')
  } catch {
    return ''
  }
  try {
    return decryptSecret(blob).trim()
  } catch {
    return ''
  }
}

export function hasStoredKey(root, id) {
  try {
    return fs.existsSync(keyPath(root, id))
  } catch {
    return false
  }
}

/** 清除某接口保存的密钥。返回是否真的删掉了文件。 */
export function clearStoredKey(root, id) {
  try {
    fs.rmSync(keyPath(root, id), { force: true })
    return true
  } catch {
    return false
  }
}

/** 列出所有已存密钥的接口 id。 */
export function listStoredKeyIds(root) {
  try {
    return fs.readdirSync(keysDir(root))
      .filter((n) => n.endsWith('.dat'))
      .map((n) => n.slice(0, -4))
  } catch {
    return []
  }
}

/** 脱敏：保留 sk- 前缀与末 4 位。 */
export function maskKey(value) {
  const v = String(value || '')
  if (!v) return ''
  if (v.length <= 8) return '••••'
  const head = v.startsWith('sk-') ? 'sk-' : ''
  return `${head}••••••••${v.slice(-4)}`
}

/** 校验密钥形态：非空、非占位符、sk- 前缀（警告不阻断）。 */
export function checkKey(value) {
  const v = typeof value === 'string' ? value.trim() : ''
  if (!v) return { ok: false, error: '密钥未配置' }
  if (PLACEHOLDER_RE.test(v)) return { ok: false, error: '密钥仍是占位符，不是真实密钥' }
  if (!v.startsWith('sk-')) return { ok: true, warning: '密钥不以 sk- 开头，仍按原值使用' }
  return { ok: true }
}

/**
 * 解析某接口当前生效的密钥。
 * @param {string} root 资产库根
 * @param {{id: string, kind?: string}} iface 接口
 * @param {object} [env]
 * @returns {{key: string, source: 'panel'|'env'|'none'|'not-needed', error?: string, warning?: string}}
 */
export function resolveApiKey(root, iface, env = process.env) {
  const id = typeof iface === 'string' ? iface : iface?.id
  const kind = typeof iface === 'object' ? iface?.kind : undefined
  // 本地 ComfyUI 不需要密钥（局域网开了鉴权也极少见，另行配置环境变量即可）
  if (kind === 'local') {
    const fromPanel = readStoredKey(root, id)
    if (fromPanel) return { key: fromPanel, source: 'panel', warning: '' }
    const envKey = String(env?.[envNameFor(id)] || '').trim()
    if (envKey) return { key: envKey, source: 'env', warning: '' }
    return { key: '', source: 'not-needed', warning: '' }
  }

  const candidates = [
    ['panel', readStoredKey(root, id)],
    ['env', String(env?.[envNameFor(id)] || '').trim()],
  ]
  let invalid = ''
  for (const [source, value] of candidates) {
    if (!value) continue
    const verdict = checkKey(value)
    if (verdict.ok) return { key: value, source, warning: verdict.warning || '' }
    if (!invalid) invalid = verdict.error
  }
  return {
    key: '',
    source: 'none',
    error: invalid
      ? `${invalid}（请在面板「设置 → 接口」里填写真实密钥）`
      : `接口「${typeof iface === 'object' ? iface?.name || id : id}」没有可用密钥：请在面板里填写，或设置环境变量 ${envNameFor(id)}`,
  }
}

export const KEY_SOURCE_LABEL = {
  panel: '面板保存（DPAPI 密文）',
  env: '环境变量',
  'not-needed': '本地接口不需要密钥',
  none: '未配置',
}

/** v1 遗留的单文件密钥路径（仅迁移用）。 */
export function legacyKeyPath(root) {
  return legacyCredentialsPath(root)
}

/**
 * 读 v1 遗留密钥（配置\credentials.dat），只用于迁移。
 * 读不到或解不开返回空串。
 */
export function readLegacyKey(root) {
  let blob
  try {
    blob = fs.readFileSync(legacyCredentialsPath(root), 'utf8')
  } catch {
    return ''
  }
  try {
    return decryptSecret(blob).trim()
  } catch {
    return ''
  }
}

/** 把 v1 遗留文件移进 配置\归档\，返回归档后的路径（没有文件时返回空串）。 */
export function archiveLegacyFiles(root, stamp = new Date()) {
  const dir = configDir(root)
  let moved = ''
  try {
    if (!fs.existsSync(legacyCredentialsPath(root))) return ''
    const dest = path.join(dir, '归档')
    fs.mkdirSync(dest, { recursive: true })
    const tag = stamp.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
    const target = path.join(dest, `credentials.dat.${tag}.bak`)
    fs.renameSync(legacyCredentialsPath(root), target)
    moved = target
  } catch {
    return ''
  }
  return moved
}
