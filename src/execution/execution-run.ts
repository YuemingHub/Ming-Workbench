import { randomUUID } from 'node:crypto'
import type { RunOutcome, RunStatus } from './run-outcome.js'
import type { ExecutionFingerprint } from './execution-fingerprint.js'
import type { EvidenceProjection } from './evidence-spine.js'

/**
 * P1-1: first-class ExecutionRun.
 *
 * A Work Unit is the human's durable goal; an ExecutionRun is ONE authorized,
 * bounded execution attempt against the real world. A retry, a re-authorization,
 * a provider switch, and an independent verification each open a NEW run.
 *
 * The Work Unit must not keep accumulating execution detail; the run record is
 * the Execution Truth container (session pointer, four-axis outcome, and the
 * evidence ids the run produced). The AAOP grant stays the authority reference;
 * nothing here re-implements grant semantics.
 */
export type ExecutionRuntime = 'deepseek-harness'

/**
 * P1-4: what a run is for. The Independent Verifier is ALSO an ExecutionRun —
 * it re-observes reality in a separate run with `purpose: 'verification'`.
 * No second runtime/session-store/ledger is introduced.
 */
export type ExecutionRunPurpose = 'execution' | 'verification'

export interface ExecutionRun {
  id: string
  workUnitId: string
  /** The AAOP grant that authorized this run (Workbench-bound correlation). */
  authorizationRef: string
  runtime: ExecutionRuntime
  provider: string
  model?: string
  /** P1-4: what this run does; defaults to 'execution'. */
  purpose?: ExecutionRunPurpose
  /** Durable canonical Harness session pointer, when a real session ran. */
  sessionId?: string
  status: RunStatus
  startedAt: string
  finishedAt?: string
  /** Four-axis outcome snapshot derived from real evidence, when available. */
  outcome?: RunOutcome
  /** Evidence ids produced by this run (referenced from the Work Unit). */
  evidenceRefs: string[]
  /** P1-2: reconstructable identity of the runtime that produced this run. */
  fingerprint?: ExecutionFingerprint
  /** P1-3: pointer-only projection of the canonical Harness session, when one ran. */
  projection?: EvidenceProjection
}

export interface OpenExecutionRunInput {
  workUnitId: string
  authorizationRef: string
  provider: string
  model?: string
  runtime?: ExecutionRuntime
  purpose?: ExecutionRunPurpose
  fingerprint?: ExecutionFingerprint
  now?: string
}

/** Open a new run. Every authorized attempt is a new run — never a resume of an old one. */
export function openExecutionRun(input: OpenExecutionRunInput): ExecutionRun {
  return {
    id: `RUN-${randomUUID()}`,
    workUnitId: input.workUnitId,
    authorizationRef: input.authorizationRef,
    runtime: input.runtime ?? 'deepseek-harness',
    provider: input.provider,
    model: input.model,
    purpose: input.purpose ?? 'execution',
    fingerprint: input.fingerprint,
    status: 'started',
    startedAt: input.now ?? new Date().toISOString(),
    evidenceRefs: [],
  }
}

export interface CloseExecutionRunInput {
  status: RunStatus
  sessionId?: string
  outcome?: RunOutcome
  evidenceRefs?: string[]
  projection?: EvidenceProjection
  now?: string
}

/** Close a run with the real outcome. A completed run never implies Work Unit acceptance. */
export function closeExecutionRun(run: ExecutionRun, input: CloseExecutionRunInput): ExecutionRun {
  return {
    ...run,
    status: input.status,
    sessionId: input.sessionId ?? run.sessionId,
    outcome: input.outcome ?? run.outcome,
    evidenceRefs: input.evidenceRefs ?? run.evidenceRefs,
    projection: input.projection ?? run.projection,
    finishedAt: input.now ?? new Date().toISOString(),
  }
}
