/**
 * Work Unit persistence types and interfaces.
 *
 * The actual Electron/desktop implementation lives in desktop/work-unit-store.mjs
 * (main process only). This module provides the type surface and the plain
 * Node.js file store used by the backend (which runs as a separate process),
 * without pulling in an Electron dependency that would break Node.js tests.
 *
 * Persisted content is product state only. It MUST NOT carry provider secrets,
 * and it is never trusted as an authorization input: on resume, the backend
 * re-reads the live repository/provider/runtime facts before continuing.
 */

import type { WorkUnit } from '../core/model.js'

export const WORK_UNIT_STORE_VERSION = 1
export const WORK_UNIT_STORE_FILE_NAME = 'work-units.json'

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
  storeVersion: number
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

export function emptyStore(projectRoot = ''): WorkUnitStore {
  return {
    storeVersion: WORK_UNIT_STORE_VERSION,
    projectRoot,
    workUnits: [],
    grants: {},
    lastProjectRoot: projectRoot || undefined,
  }
}

export function toPersistedWorkUnit(unit: WorkUnit): PersistedWorkUnit {
  return {
    id: unit.id,
    spaceId: unit.spaceId,
    title: unit.title,
    outcome: unit.outcome,
    state: unit.state,
    owner: unit.owner,
    gate: { ...unit.gate },
    acceptance: unit.acceptance.map((c) => ({ ...c, evidenceIds: [...c.evidenceIds] })),
    evidence: unit.evidence.map((e) => ({ ...e })),
    assets: unit.assets.map((a) => ({ ...a })),
    nextFrontier: unit.nextFrontier,
    createdAt: unit.createdAt,
    updatedAt: unit.updatedAt,
  }
}

export function fromPersistedWorkUnit(record: PersistedWorkUnit): WorkUnit {
  return {
    id: record.id,
    spaceId: record.spaceId,
    title: record.title,
    outcome: record.outcome,
    state: record.state as WorkUnit['state'],
    owner: record.owner,
    gate: {
      kind: record.gate.kind as WorkUnit['gate']['kind'],
      open: record.gate.open,
      summary: record.gate.summary,
      owner: record.gate.owner as WorkUnit['gate']['owner'],
    },
    acceptance: record.acceptance.map((c) => ({ ...c, evidenceIds: [...c.evidenceIds] })),
    evidence: record.evidence.map((e) => ({
      ...e,
      kind: e.kind as WorkUnit['evidence'][number]['kind'],
    })),
    assets: record.assets.map((a) => ({
      ...a,
      kind: a.kind as WorkUnit['assets'][number]['kind'],
    })),
    nextFrontier: record.nextFrontier,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

/**
 * No-op store for environments without a writable store
 * (tests, web-only mode without a store directory).
 */
export const noopWorkUnitStore: WorkUnitStoreApi = {
  load: () => emptyStore(),
  save: () => {},
  clear: () => {},
}
