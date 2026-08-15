/**
 * Work Unit persistence for Ming Workbench Desktop (Electron main process).
 *
 * The desktop main process and the backend Node process share the SAME JSON
 * file inside userData, so a Work Unit authored by the backend survives
 * close/reopen and is visible here for resume.
 *
 * Design:
 * - userData (Electron-owned), never APPDATA/LOCALAPPDATA guesswork.
 * - schema version is validated on load; a mismatch is treated as empty, never
 *   trusted as an authorization input.
 * - persisted content carries no provider secret.
 * - on resume the backend re-reads live repository/provider/runtime facts.
 */

import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const STORE_FILE_NAME = 'work-units.json'
const STORE_VERSION = 2
const MIN_SUPPORTED_VERSION = 1

function storePath() {
  return join(app.getPath('userData'), STORE_FILE_NAME)
}

function emptyStore() {
  return {
    storeVersion: STORE_VERSION,
    projectRoot: '',
    workUnits: [],
    grants: {},
    runs: [],
    lastProjectRoot: undefined,
  }
}

export function loadWorkUnitStore() {
  try {
    const path = storePath()
    if (!existsSync(path)) return emptyStore()
    const raw = JSON.parse(readFileSync(path, 'utf8'))
    // v1 (no runs) and v2 (P1-1 runs) are readable; an unknown newer or older
    // version is never trusted as an authorization input.
    const version = raw?.storeVersion
    const supported =
      typeof version === 'number' &&
      version >= MIN_SUPPORTED_VERSION &&
      version <= STORE_VERSION
    if (!raw || !supported) {
      return emptyStore()
    }
    return {
      storeVersion: STORE_VERSION,
      projectRoot: typeof raw.projectRoot === 'string' ? raw.projectRoot : '',
      workUnits: Array.isArray(raw.workUnits) ? raw.workUnits : [],
      grants: raw.grants && typeof raw.grants === 'object' ? raw.grants : {},
      runs: Array.isArray(raw.runs) ? raw.runs : [],
      lastProjectRoot: raw.lastProjectRoot,
    }
  } catch {
    return emptyStore()
  }
}

export function saveWorkUnitStore(store) {
  try {
    const dir = app.getPath('userData')
    mkdirSync(dir, { recursive: true })
    writeFileSync(storePath(), `${JSON.stringify({ ...store, storeVersion: STORE_VERSION }, null, 2)}\n`, 'utf8')
  } catch {
    // Best-effort persistence; never block the product flow on a save error.
  }
}

export function clearWorkUnitStore() {
  try {
    const path = storePath()
    if (existsSync(path)) unlinkSync(path)
  } catch {
    // Best-effort cleanup.
  }
}
