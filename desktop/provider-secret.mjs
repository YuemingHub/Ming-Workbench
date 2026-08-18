/**
 * Provider secret management using Electron safeStorage.
 *
 * Security boundary:
 * - 静态持久化：API key 只以加密形式存储在 Electron safeStorage
 *   (DPAPI on Windows, Keychain on macOS, libsecret on Linux)。
 *   不写入项目目录、Git 仓库、配置文件或日志。
 * - 运行时传递：解密后的 key 仅通过受控的 allowlisted child env
 *   传给 backend/Harness 进程，不暴露给 renderer。
 * - 严禁进入：repo、Git diff/log、日志、Work Unit、Evidence、
 *   argv、renderer storage (localStorage/sessionStorage)、plaintext 配置文件。
 */

import { safeStorage, app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const SECRET_FILE_NAME = 'provider-secret.enc'

function secretPath() {
  return join(app.getPath('userData'), SECRET_FILE_NAME)
}

export function loadProviderSecret() {
  try {
    const path = secretPath()
    if (!existsSync(path)) return null
    const encrypted = readFileSync(path)
    return safeStorage.decryptString(encrypted)
  } catch {
    return null
  }
}

export function saveProviderSecret(plaintext) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'Electron safeStorage is not available on this system. Cannot store provider secret securely.',
    )
  }
  const encrypted = safeStorage.encryptString(plaintext)
  const dir = app.getPath('userData')
  mkdirSync(dir, { recursive: true })
  writeFileSync(secretPath(), encrypted)
}

export function clearProviderSecret() {
  try {
    const path = secretPath()
    if (existsSync(path)) {
      // Overwrite with zeros before deleting to minimize forensic recovery.
      const stats = readFileSync(path)
      writeFileSync(path, Buffer.alloc(stats.length).fill(0))
      unlinkSync(path)
    }
  } catch {
    // Best-effort.
  }
}

export function hasProviderSecret() {
  return loadProviderSecret() !== null
}
