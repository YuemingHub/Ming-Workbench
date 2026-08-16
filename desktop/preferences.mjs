/**
 * Non-secret provider preferences (provider, model, optional base URL).
 *
 * Security boundary: the API key is NEVER stored here. It lives only in
 * Electron safeStorage (provider-secret.mjs). Preferences are plain JSON
 * under the app userData directory — never in the target project, never in
 * the Ming Workbench repo, never in logs.
 */

import { createRequire } from 'node:module'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const require = createRequire(import.meta.url)

const PREFERENCES_FILE_NAME = 'provider-preferences.json'

function defaultUserDataDir() {
  // electron is only available inside the desktop main process; unit tests
  // always pass an explicit userData directory.
  try {
    return require('electron').app.getPath('userData')
  } catch {
    return undefined
  }
}

export function defaultProviderPreferences() {
  return { provider: 'deepseek-official', model: 'deepseek-v4-pro', baseUrl: '' }
}

export function normalizeProviderPreferences(value) {
  const base = defaultProviderPreferences()
  if (!value || typeof value !== 'object') return base
  const provider = typeof value.provider === 'string' ? value.provider.trim() : ''
  const model = typeof value.model === 'string' ? value.model.trim() : ''
  const baseUrl = typeof value.baseUrl === 'string' ? value.baseUrl.trim() : ''
  const out = { ...base }
  if (provider && provider.length <= 200) out.provider = provider
  if (model && model.length <= 200) out.model = model
  if (baseUrl.length <= 500) out.baseUrl = baseUrl
  return out
}

function preferencesPath(userDataDir) {
  return join(userDataDir, PREFERENCES_FILE_NAME)
}

export function loadProviderPreferences(userDataDir = defaultUserDataDir()) {
  try {
    const path = preferencesPath(userDataDir)
    if (!existsSync(path)) return defaultProviderPreferences()
    return normalizeProviderPreferences(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    return defaultProviderPreferences()
  }
}

export function saveProviderPreferences(preferences, userDataDir = defaultUserDataDir()) {
  const normalized = normalizeProviderPreferences(preferences)
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(
    preferencesPath(userDataDir),
    `${JSON.stringify(normalized, null, 2)}\n`,
    'utf8',
  )
  return normalized
}

export function clearProviderPreferences(userDataDir = defaultUserDataDir()) {
  try {
    const path = preferencesPath(userDataDir)
    if (existsSync(path)) rmSync(path, { force: true })
  } catch {
    // Best-effort.
  }
}
