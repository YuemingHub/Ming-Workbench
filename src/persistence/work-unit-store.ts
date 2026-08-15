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
import type { ExecutionRun, ExecutionRunPurpose } from '../execution/execution-run.js'
import type { Verification } from '../execution/verification.js'

/**
 * Store schema version.
 *
 * v1 -> v2: added `runs` (P1-1 first-class ExecutionRun).
 * v2 -> v3: added `verifications` (P1-4 Independent Verification) and the
 * `runs[].purpose` field.
 * Loaders accept any version in [min, max]; older files are read with the new
 * collections empty. This is the only supported forward migration; an unknown
 * newer version is never trusted as an authorization input.
 */
export const WORK_UNIT_STORE_VERSION = 3
export const WORK_UNIT_STORE_FILE_NAME = 'work-units.json'
export const WORK_UNIT_STORE_MIN_SUPPORTED_VERSION = 1
export interface MutableFacts {
  projectId: string
  gitHead: string
  gitBranch: string
  gitDirty: boolean
  providerAvailable: boolean
  harnessAvailable: boolean
}

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
    verifier?: string
    verification?: string
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
  /** Frozen human-authorized mutation boundary (P0-1). */
  slice?: {
    repository: string
    baseRef: string
    scope: {
      kind: 'exact' | 'unknown' | 'whole-repository'
      paths?: string[]
    }
  }
  /**
   * Legacy pre-P0-1 authorized surface. Older stores recorded
   * `[projectRoot]` as a disguised whole-repository scope; the loader
   * migrates that to an explicit whole-repository slice.
   */
  intendedFiles?: string[]
}

/** Durable shape of an ExecutionRun (P1-1). */
export interface PersistedExecutionRun {
  id: string
  workUnitId: string
  authorizationRef: string
  runtime: string
  provider: string
  model?: string
  /** P1-4: what this run does ('execution' | 'verification'). */
  purpose?: string
  sessionId?: string
  status: string
  startedAt: string
  finishedAt?: string
  outcome?: {
    runStatus: string
    effect: string
    verification: string
    acceptance: string
    reason: string
  }
  evidenceRefs: string[]
  /** P1-2: reconstructable runtime identity (identity + digest + pointer). */
  fingerprint?: {
    harness: { version: string; commit: string }
    profile: { id: string; digest: string }
    provider: string
    model?: string
    permissionPreset: string
    sandboxMode: string
    workspace: { repository: string; baseRef: string }
    workbenchConfigDigest: string
  }
  /** P1-3: pointer-only projection of the canonical Harness session. */
  projection?: {
    session: {
      pointer: {
        sessionRoot: string
        cwd: string
        sessionId: string
        artifactPath: string
        artifactRel: string
      }
      header: {
        id: string
        version: number
        createdAt: number
        cwd?: string
        parentSession?: string
        seedLength?: number
        origin?: 'subagent'
        delegationDepth?: number
        agentPreset?: string
      }
      revision: { dev: string; ino: string; size: string; mtimeMs: number }
      digest: string
      frames: number
      committedBytes: number
    }
    eventRange: { count: number; firstSeq?: number; lastSeq?: number }
  }
}

/** Durable shape of an Independent Verification (P1-4). */
export interface PersistedVerification {
  id: string
  workUnitId: string
  verifierRunId: string
  subjectRunId: string
  criterionId: string
  verdict: string
  evidenceRefs: string[]
  observations: string[]
  observedAt: string
}

export interface WorkUnitStore {
  storeVersion: number
  projectRoot: string
  workUnits: PersistedWorkUnit[]
  grants: Record<string, PersistedGrant>
  /** P1-1: every authorized execution attempt, oldest first. */
  runs: PersistedExecutionRun[]
  /** P1-4: every independent verification, oldest first. */
  verifications: PersistedVerification[]
  lastProjectRoot?: string
  lastMutableFacts?: MutableFacts
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
    runs: [],
    verifications: [],
    lastProjectRoot: projectRoot || undefined,
  }
}

export function toMutableFacts(
  projectRoot: string,
  workUnit: PersistedWorkUnit,
): MutableFacts {
  return {
    projectId: workUnit.spaceId,
    gitHead: '',
    gitBranch: '',
    gitDirty: false,
    providerAvailable: false,
    harnessAvailable: false,
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

/** P1-1: persist an ExecutionRun without copying AAOP grant internals. */
export function toPersistedExecutionRun(run: ExecutionRun): PersistedExecutionRun {
  return {
    id: run.id,
    workUnitId: run.workUnitId,
    authorizationRef: run.authorizationRef,
    runtime: run.runtime,
    provider: run.provider,
    model: run.model,
    purpose: run.purpose,
    sessionId: run.sessionId,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    outcome: run.outcome,
    evidenceRefs: [...run.evidenceRefs],
    fingerprint: run.fingerprint,
    projection: run.projection,
  }
}

/** P1-1: rebuild an ExecutionRun from its durable record. */
export function fromPersistedExecutionRun(record: PersistedExecutionRun): ExecutionRun {
  return {
    id: record.id,
    workUnitId: record.workUnitId,
    authorizationRef: record.authorizationRef,
    runtime: record.runtime as ExecutionRun['runtime'],
    provider: record.provider,
    model: record.model,
    purpose: (record.purpose ?? 'execution') as ExecutionRunPurpose,
    sessionId: record.sessionId,
    status: record.status as ExecutionRun['status'],
    startedAt: record.startedAt,
    finishedAt: record.finishedAt,
    outcome: record.outcome as ExecutionRun['outcome'],
    evidenceRefs: [...(record.evidenceRefs ?? [])],
    fingerprint: record.fingerprint as ExecutionRun['fingerprint'],
    projection: record.projection as ExecutionRun['projection'],
  }
}

/** P1-4: persist an Independent Verification. */
export function toPersistedVerification(verification: Verification): PersistedVerification {
  return {
    id: verification.id,
    workUnitId: verification.workUnitId,
    verifierRunId: verification.verifierRunId,
    subjectRunId: verification.subjectRunId,
    criterionId: verification.criterionId,
    verdict: verification.verdict,
    evidenceRefs: [...verification.evidenceRefs],
    observations: [...verification.observations],
    observedAt: verification.observedAt,
  }
}

/** P1-4: rebuild an Independent Verification from its durable record. */
export function fromPersistedVerification(record: PersistedVerification): Verification {
  return {
    id: record.id,
    workUnitId: record.workUnitId,
    verifierRunId: record.verifierRunId,
    subjectRunId: record.subjectRunId,
    criterionId: record.criterionId,
    verdict: record.verdict as Verification['verdict'],
    evidenceRefs: [...(record.evidenceRefs ?? [])],
    observations: [...(record.observations ?? [])],
    observedAt: record.observedAt,
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
      verifier: e.verifier as WorkUnit['evidence'][number]['verifier'],
      verification: e.verification as WorkUnit['evidence'][number]['verification'],
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
