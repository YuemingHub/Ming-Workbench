import { readRepositorySnapshot, type RepositorySnapshot } from './repository.js'
import { isPathWithinSlice, sliceScopeLabel, type MutationSlice } from './mutation-slice.js'
import type { ExecutionRun } from './execution-run.js'
import type { ProviderExecutionGrant } from './provider-grant.js'
import type { PersistedExecutionRun } from '../persistence/work-unit-store.js'
import { fromPersistedExecutionRun } from '../persistence/work-unit-store.js'

/**
 * P1-5: Crash / Orphaned Run Recovery.
 *
 * A Workbench may die while a run is not terminal (started / running). On
 * restart the system must NOT pretend nothing happened and must NOT blindly
 * retry (UNKNOWN ≠ RETRY) — the first attempt may already have mutated files,
 * pushed code, called an API, or produced an external effect.
 *
 * Each non-terminal durable run is marked orphaned / reconciling, then reality
 * is re-observed (repository working tree, granted slice, authorization
 * freshness) to attribute any existing effect and to decide one of:
 *
 *   safe-to-resume          no effect observed + authority still valid
 *   requires-new-run        an effect was observed; re-running would double it
 *   requires-reauthorization authority drifted (HEAD/base_ref or mutable facts)
 *   effect-unknown          reality cannot be fully observed
 *   needs-human             an observed effect requires a human decision
 *   reconciled-completed    the reality proves the run's outcome as complete
 *   reconciled-failed       the reality proves the run's outcome as failed
 *
 * The recovery itself produces evidence (observations + attributed changes)
 * that trace back to the ORIGINAL ExecutionRun. A crash is a fact and is never
 * erased by rewriting history.
 */

export const NON_TERMINAL_STATUSES = new Set(['started', 'running'])

export type RecoveryDecision =
  | 'safe-to-resume'
  | 'requires-new-run'
  | 'requires-reauthorization'
  | 'effect-unknown'
  | 'needs-human'
  | 'reconciled-completed'
  | 'reconciled-failed'

export interface OrphanRecoveryObservation {
  kind: 'repository' | 'session' | 'authority' | 'effect'
  summary: string
  detail?: string
}

export interface OrphanRecoveryResult {
  run: ExecutionRun
  /** Non-terminal runs are reported as orphaned; recovery state is explicit. */
  orphaned: boolean
  decision: RecoveryDecision
  /** Independent reality observations the recovery made. */
  observations: OrphanRecoveryObservation[]
  /** Working-tree files attributed to the orphaned run (subset of slice). */
  attributedChanges: string[]
  reconciledAt: string
}

export interface OrphanRecoveryOptions {
  /** The durable run record (non-terminal) being reconciled. */
  run: ExecutionRun
  /** The frozen human-authorized mutation boundary (for attribution). */
  slice: MutationSlice
  /** Absolute project directory whose reality is re-observed. */
  projectRoot: string
  /** The AAOP grant that authorized the run (for authority freshness). */
  grant?: ProviderExecutionGrant
  /** When a canonical Harness session artifact is known to exist. */
  sessionArtifactKnown?: boolean
  now?: string
}

/**
 * Reconcile one orphaned (non-terminal) ExecutionRun by re-observing reality.
 *
 * This is the anti-blind-retry gate: the decision is derived from real
 * observations, never from a hunch. When an effect is observed the run can
 * never silently resume under a fresh run id.
 */
export function reconcileOrphanedRun(
  options: OrphanRecoveryOptions,
): OrphanRecoveryResult {
  const observations: OrphanRecoveryObservation[] = []
  const snapshot: RepositorySnapshot = readRepositorySnapshot(options.projectRoot)

  // Working-tree files that are inside the authorized slice: candidate effects
  // attributable to the orphaned run.
  const attributedChanges = snapshot.dirtyFiles.filter((file) =>
    isPathWithinSlice(options.slice, file),
  )
  // Files outside the slice are never attributable to a bounded run.
  const outOfSlice = snapshot.dirtyFiles.filter((file) =>
    !isPathWithinSlice(options.slice, file),
  )

  observations.push({
    kind: 'repository',
    summary: `repository HEAD ${snapshot.head}; ${snapshot.dirtyFiles.length} dirty file(s); ${attributedChanges.length} within authorized surface ${sliceScopeLabel(options.slice)}`,
  })

  // Authority freshness: a stale grant must never authorize a resume.
  const baseRef = options.grant?.authorization?.write_target?.base_ref
  let authorityValid = true
  if (baseRef && snapshot.head && baseRef !== snapshot.head) {
    authorityValid = false
    observations.push({
      kind: 'authority',
      summary: `grant base_ref ${baseRef} differs from live HEAD ${snapshot.head}; the authorization is stale`,
    })
  }

  // Out-of-slice changes mean the reality does not match the authorization;
  // a human must decide — never a blind retry.
  if (outOfSlice.length > 0) {
    observations.push({
      kind: 'effect',
      summary: `changes outside the authorized surface observed: ${outOfSlice.join(', ')}`,
      detail: outOfSlice.join(', '),
    })
    return decisionResult(options, 'needs-human', observations, attributedChanges, snapshot)
  }

  // An in-slice effect exists: the first attempt DID mutate reality. It is
  // attributed to the orphaned run. Re-execution would double the effect, so
  // a fresh run is never created automatically.
  if (attributedChanges.length > 0) {
    observations.push({
      kind: 'effect',
      summary: `working-tree changes attributable to the orphaned run: ${attributedChanges.join(', ')}`,
      detail: attributedChanges.join(', '),
    })
    const decision: RecoveryDecision = authorityValid
      ? 'requires-new-run'
      : 'requires-reauthorization'
    return decisionResult(options, decision, observations, attributedChanges, snapshot)
  }

  // No working-tree effect. If a session artifact exists we cannot rule out
  // external effects — UNKNOWN, and UNKNOWN is not retryable by machine.
  if (options.sessionArtifactKnown) {
    observations.push({
      kind: 'session',
      summary: 'a canonical Harness session artifact exists but no repository change was observed; external effects cannot be excluded',
    })
    return decisionResult(options, 'effect-unknown', observations, attributedChanges, snapshot)
  }

  // No effect observed and authority still valid: the run may safely resume.
  // (A resume is an explicit, human-visible continuation of the SAME run — it
  // is not a blind retry that re-executes from scratch.)
  if (authorityValid) {
    observations.push({
      kind: 'authority',
      summary: 'no effect observed and the authorization is still fresh; resuming the same run is safe',
    })
    return decisionResult(options, 'safe-to-resume', observations, attributedChanges, snapshot)
  }

  observations.push({
    kind: 'authority',
    summary: 'no effect observed but the authorization is stale; a fresh authorization is required before any continuation',
  })
  return decisionResult(options, 'requires-reauthorization', observations, attributedChanges, snapshot)
}

function decisionResult(
  options: OrphanRecoveryOptions,
  decision: RecoveryDecision,
  observations: OrphanRecoveryObservation[],
  attributedChanges: string[],
  _snapshot: RepositorySnapshot,
): OrphanRecoveryResult {
  return {
    run: options.run,
    orphaned: NON_TERMINAL_STATUSES.has(options.run.status),
    decision,
    observations,
    attributedChanges,
    reconciledAt: options.now ?? new Date().toISOString(),
  }
}

/**
 * Find every non-terminal run in the store and reconcile it against reality.
 * Returns the per-run results plus which runs were touched. This is the
 * Workbench startup hook (P1-5 restart reconciliation).
 */
export function reconcileOrphanedRuns(
  runs: PersistedExecutionRun[],
  opts: {
    slice: MutationSlice
    projectRoot: string
    grantsByRunId?: Record<string, ProviderExecutionGrant>
    sessionArtifactKnownForRunId?: (runId: string) => boolean
    now?: string
  },
): OrphanRecoveryResult[] {
  return runs
    .filter((r) => NON_TERMINAL_STATUSES.has(r.status))
    .map((record) => {
      const run = fromPersistedExecutionRun(record)
      return reconcileOrphanedRun({
        run,
        slice: opts.slice,
        projectRoot: opts.projectRoot,
        grant: opts.grantsByRunId?.[run.id],
        sessionArtifactKnown: opts.sessionArtifactKnownForRunId?.(run.id) ?? false,
        now: opts.now,
      })
    })
}
