/**
 * Provider secret management using Electron safeStorage.
 *
 * Security boundary:
 * - The raw API key is never exposed to the renderer process.
 * - The main process stores the encrypted key using Electron safeStorage
 *   (DPAPI on Windows, Keychain on macOS, libsecret on Linux).
 * - The decrypted key is injected only into the backend child process env.
 * - The backend passes it to the Harness ACP child via SAFE_INHERITED_ENV.
 * - The key never enters project files, Git, logs, Work Unit, Evidence,
 *   or renderer localStorage.
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
