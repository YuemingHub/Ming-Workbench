/**
 * Work Unit persistence types and interfaces.
 *
 * The actual Electron implementation lives in desktop/work-unit-store.mjs
 * (main process only). This module provides the type surface without
 * pulling in an Electron dependency that would break Node.js tests.
 */

export interface PersistedWorkUnit {
  id: string
  spaceId: string
  title: string
  outcome: string
  state: string
  owner: string
  gate: {
    kind: string
    open: boolean
    summary?: string
    owner?: string
  }
  acceptance: Array<{
    id: string
    statement: string
    satisfied: boolean
    evidenceIds: string[]
  }>
  evidence: Array<{
    id: string
    kind: string
    summary: string
    uri?: string
    observedAt: string
    authoritative: boolean
  }>
  assets: Array<{
    id: string
    kind: string
    title: string
    uri?: string
  }>
  nextFrontier?: string
  createdAt: string
  updatedAt: string
}

export interface PersistedGrant {
  grant: Record<string, unknown>
  binding: {
    workUnitId: string
    grantId: string
  }
}

export interface WorkUnitStore {
  projectRoot: string
  workUnits: PersistedWorkUnit[]
  grants: Record<string, PersistedGrant>
  lastProjectRoot?: string
}

export interface WorkUnitStoreApi {
  load(): WorkUnitStore
  save(store: WorkUnitStore): void
  clear(): void
}

/**
 * No-op store for environments without Electron (tests, web-only mode).
 */
export const noopWorkUnitStore: WorkUnitStoreApi = {
  load: () => ({ projectRoot: '', workUnits: [], grants: {} }),
  save: () => {},
  clear: () => {},
}
