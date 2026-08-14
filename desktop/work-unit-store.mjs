/**
 * Work Unit persistence for Ming Workbench Desktop (Electron main process).
 *
 * Survives app close/reopen and crash/restart. Uses JSON file in userData
 * because:
 * - No database required for the observed pressure
 * - No event bus required for single-process desktop
 * - File is sufficient for the Work Unit count we expect
 *
 * On resume, mutable facts (repository state, branch, tests, provider)
 * are re-read and validated before any Work Unit can continue.
 * Local state alone never authorizes continuation.
 */

import { safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

const STORE_FILE_NAME = 'work-units.json'

function storePath() {
  return join(process.env.APPDATA || process.env.LOCALAPPDATA || '', 'Ming Workbench', STORE_FILE_NAME)
}

export function loadWorkUnitStore(): {
  projectRoot: string
  workUnits: Array<Record<string, unknown>>
  grants: Record<string, { grant: Record<string, unknown>; binding: { workUnitId: string; grantId: string } }>
  lastProjectRoot?: string
} {
  try {
    const path = storePath()
    if (!existsSync(path)) {
      return { projectRoot: '', workUnits: [], grants: {} }
    }
    const raw = readFileSync(path, 'utf8')
    return JSON.parse(raw)
  } catch {
    return { projectRoot: '', workUnits: [], grants: {} }
  }
}

export function saveWorkUnitStore(store: {
  projectRoot: string
  workUnits: Array<Record<string, unknown>>
  grants: Record<string, { grant: Record<string, unknown>; binding: { workUnitId: string; grantId: string } }>
  lastProjectRoot?: string
}): void {
  try {
    const dir = join(process.env.APPDATA || process.env.LOCALAPPDATA || '', 'Ming Workbench')
    mkdirSync(dir, { recursive: true })
    writeFileSync(storePath(), JSON.stringify(store, null, 2))
  } catch {
    // Best-effort persistence.
  }
}

export function clearWorkUnitStore(): void {
  try {
    const path = storePath()
    if (existsSync(path)) {
      unlinkSync(path)
    }
  } catch {
    // Best-effort cleanup.
  }
}
