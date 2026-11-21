// 共享纯逻辑：v1 → v2 配置迁移（一次性）。
//
// v1：配置\settings.json 单接口（baseUrl + defaultModel）+ 配置\credentials.dat 单密钥。
// v2：settings.json 的 interfaces[] + 配置\密钥\<接口id>.dat。
//
// 迁移策略（用户确认过的口径）：
//   - 生成一条名为「旧配置」的云端接口，保留原 baseUrl / defaultModel / 模型清单
//   - 把旧密钥复制成该接口的 DPAPI 密文（旧文件按 归档\credentials.dat.<时间>.bak 归档，不删除）
//   - **不**把它设成默认接口：默认接口与默认模型由用户手动指定
//
// 只依赖 node:fs / node:path。

import fs from 'node:fs'
import path from 'node:path'
import { readSettings, writeSettings, settingsPath, archiveDir, legacyCredentialsPath } from './配置.js'
import { saveKey, readLegacyKey, keyPath } from './密钥.js'

export const LEGACY_INTERFACE_ID = 'legacy'

function stamp(d = new Date()) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}

function readRawSettings(root) {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(root), 'utf8'))
  } catch {
    return null
  }
}

/** 把 v1 的 settings.json 备份到 配置\归档\（只有确实是 v1 才备份）。 */
export function backupV1Settings(root, d = new Date()) {
  const raw = readRawSettings(root)
  if (!raw || Array.isArray(raw.interfaces)) return ''
  try {
    const dest = archiveDir(root)
    fs.mkdirSync(dest, { recursive: true })
    const target = path.join(dest, `settings.v1.${stamp(d)}.bak.json`)
    fs.writeFileSync(target, JSON.stringify(raw, null, 2), 'utf8')
    return target
  } catch {
    return ''
  }
}

/** 把 v1 的 credentials.dat 归档（改名而不是删除）。 */
export function backupV1Key(root, d = new Date()) {
  try {
    if (!fs.existsSync(legacyCredentialsPath(root))) return ''
    const dest = archiveDir(root)
    fs.mkdirSync(dest, { recursive: true })
    const target = path.join(dest, `credentials.dat.${stamp(d)}.bak`)
    fs.renameSync(legacyCredentialsPath(root), target)
    return target
  } catch {
    return ''
  }
}

/**
 * 执行迁移。可重复调用：已经迁移过（v2 + 旧密钥已归档）时返回 migrated:false。
 * @returns {{migrated: boolean, settings: object, interfaceId: string, keyMigrated: boolean, warnings: string[], backups: object}}
 */
export function migrateIfNeeded(root, d = new Date()) {
  const current = readSettings(root)
  const raw = readRawSettings(root)
  const alreadyV2 = raw && Array.isArray(raw.interfaces)
  const warnings = []
  const backups = { settings: '', key: '' }

  // v2 但旧密钥还留在 配置\credentials.dat：只归档，不再动 settings
  if (alreadyV2) {
    if (fs.existsSync(legacyCredentialsPath(root))) {
      backups.key = backupV1Key(root, d)
      if (backups.key) warnings.push('v1 遗留的 credentials.dat 已归档到 配置\\归档（v2 已按接口分文件保存密钥）')
    }
    return { migrated: false, settings: current, interfaceId: '', keyMigrated: false, warnings, backups }
  }

  // 真正的 v1（或空配置）：只有存在 v1 特征时才迁移
  const legacyShape = raw && !Array.isArray(raw.interfaces) && (raw.baseUrl || raw.defaultModel)
  if (!legacyShape) {
    return { migrated: false, settings: current, interfaceId: '', keyMigrated: false, warnings, backups }
  }

  backups.settings = backupV1Settings(root, d)
  const baseUrl = typeof raw.baseUrl === 'string' ? raw.baseUrl.trim() : ''
  const defaultModel = typeof raw.defaultModel === 'string' ? raw.defaultModel.trim() : ''

  // 注意：readSettings() 会把 v1 结构在内存里归一化成「旧配置」接口，
  // 所以这里必须按磁盘原始 JSON 判断是否已经写入过，否则永远不落盘。
  const existing = (Array.isArray(raw?.interfaces) ? raw.interfaces : [])
    .find((it) => it?.id === LEGACY_INTERFACE_ID)
  let settings = current
  if (!existing) {
    if (!baseUrl) {
      warnings.push('v1 配置里没有接口地址，旧配置接口被跳过（没有生成任何接口）')
    } else {
      const models = Array.isArray(raw.models) && raw.models.length
        ? raw.models
        : defaultModel ? [defaultModel] : []
      // current 已经把 v1 在内存里归一化出一条 legacy 接口，写盘时要去重
      const kept = current.interfaces.filter((it) => it.id !== LEGACY_INTERFACE_ID)
      settings = writeSettings(root, {
        interfaces: [
          ...kept,
          {
            id: LEGACY_INTERFACE_ID,
            name: '旧配置',
            kind: 'cloud',
            baseUrl,
            defaultModel,
            models,
            enabled: true,
          },
        ],
        // 迁移过来的接口不设为默认：defaultInterface 保持空
        defaultInterface: '',
        defaultSize: current.defaultSize,
        defaultCount: current.defaultCount,
        timeoutMs: current.timeoutMs,
      })
    }
  }

  // 密钥：把 v1 明文（DPAPI 解密后）重新加密成该接口的密文，再归档旧文件
  let keyMigrated = false
  const legacyKey = readLegacyKey(root)
  if (legacyKey) {
    try {
      if (!fs.existsSync(keyPath(root, LEGACY_INTERFACE_ID))) {
        saveKey(root, LEGACY_INTERFACE_ID, legacyKey)
        keyMigrated = true
      }
    } catch (err) {
      warnings.push(`旧密钥迁移失败（${err.message}）：旧文件保留在 配置\\credentials.dat，可在面板重新填写`)
    }
  }
  if (fs.existsSync(legacyCredentialsPath(root)) && (keyMigrated || !legacyKey)) {
    backups.key = backupV1Key(root, d)
    if (!keyMigrated && !legacyKey) {
      warnings.push('旧密钥无法解密（可能换了 Windows 用户或系统），已归档旧文件；请在面板重新填写密钥')
    }
  }

  if (settings.defaultInterface) {
    warnings.push('迁移后的默认接口已失效，已在设置里清空：请手动指定默认接口')
  }
  return { migrated: true, settings: readSettings(root), interfaceId: LEGACY_INTERFACE_ID, keyMigrated, warnings, backups }
}
