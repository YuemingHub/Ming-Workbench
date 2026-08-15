/**
 * File-based Work Unit store for the backend process.
 *
 * The backend runs as a separate Node process. It shares the same JSON file as
 * the desktop main process (both resolve to the same userData directory), so a
 * Work Unit authored in one process is visible after close/reopen in the other.
 *
 * Persisted content is never trusted as authorization: the caller must
 * re-read live repository/provider/runtime facts before continuing any Work
 * Unit. A mismatched storeVersion is treated as empty (not upgraded blindly).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

import {
  emptyStore,
  WORK_UNIT_STORE_FILE_NAME,
  WORK_UNIT_STORE_MIN_SUPPORTED_VERSION,
  WORK_UNIT_STORE_VERSION,
  type WorkUnitStore,
  type WorkUnitStoreApi,
} from './work-unit-store.js'

export function createFileWorkUnitStore(storeDir: string): WorkUnitStoreApi {
  const path = join(storeDir, WORK_UNIT_STORE_FILE_NAME)

  function load(): WorkUnitStore {
    try {
      if (!existsSync(path)) return emptyStore()
      const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<WorkUnitStore>
      // v1 (no runs) and v2 (P1-1 runs) are readable; an unknown newer or
      // older version is never trusted as an authorization input.
      const version = raw.storeVersion
      const supported =
        typeof version === 'number' &&
        version >= WORK_UNIT_STORE_MIN_SUPPORTED_VERSION &&
        version <= WORK_UNIT_STORE_VERSION
      if (!raw || !supported) {
        return emptyStore()
      }
      return {
        storeVersion: WORK_UNIT_STORE_VERSION,
        projectRoot: typeof raw.projectRoot === 'string' ? raw.projectRoot : '',
        workUnits: Array.isArray(raw.workUnits) ? raw.workUnits : [],
        grants: raw.grants && typeof raw.grants === 'object' ? raw.grants : {},
        // P1-1: a v1 file simply has no runs yet.
        runs: Array.isArray(raw.runs) ? raw.runs : [],
        // P1-4: a v1/v2 file simply has no verifications yet.
        verifications: Array.isArray(raw.verifications) ? raw.verifications : [],
        lastProjectRoot: raw.lastProjectRoot,
        // The last observed mutable-facts snapshot drives the stale-authority
        // check on /api/execute. Dropping it on load silently disabled the 409
        // path; the snapshot itself is never trusted as an authorization input
        // (the live repository is re-read before any continuation).
        lastMutableFacts:
          raw.lastMutableFacts && typeof raw.lastMutableFacts === 'object'
            ? (raw.lastMutableFacts as WorkUnitStore['lastMutableFacts'])
            : undefined,
      }
    } catch {
      return emptyStore()
    }
  }

  function save(store: WorkUnitStore): void {
    try {
      mkdirSync(storeDir, { recursive: true })
      const persisted: WorkUnitStore = { ...store, storeVersion: WORK_UNIT_STORE_VERSION }
      writeFileSync(path, `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')
    } catch {
      // Best-effort persistence; never block the product flow on a save error.
    }
  }

  function clear(): void {
    try {
      if (existsSync(path)) unlinkSync(path)
    } catch {
      // Best-effort cleanup.
    }
  }

  return { load, save, clear }
}
