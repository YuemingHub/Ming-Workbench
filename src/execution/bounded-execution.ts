import type { WorkUnit } from '../core/model.js'
import {
  assertHarnessExecutionGrant,
  assertWorkbenchExecutionBinding,
  type ProviderExecutionGrant,
  type WorkbenchExecutionBinding,
} from './provider-grant.js'
import {
  runHarnessAcpGrant,
  type HarnessAcpRunOptions,
  type HarnessAcpRunResult,
} from '../transports/harness-acp.js'
import {
  computeExecutionDelta,
  readRepositorySnapshot,
  reconcileBeforeMutation,
  reconcileExternalEffect,
  type RepositorySnapshot,
} from './repository.js'
import {
  assertSliceAllowsWrite,
  sliceScopeLabel,
  type MutationSlice,
} from './mutation-slice.js'
import {
  deriveRunOutcome,
  type RunOutcome,
} from './run-outcome.js'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

export interface BoundedExecutionOptions {
  /** Authoritative Work Unit resolved from the backend store, never browser-supplied. */
  workUnit: WorkUnit
  /** AAOP-schema grant resolved from the backend store, never browser-supplied. */
  grant: ProviderExecutionGrant
  /** Workbench-owned correlation resolved from the backend store. */
  binding: WorkbenchExecutionBinding
  /**
   * The frozen human-authorized mutation boundary. P0-1: never derived from a
   * project-root fallback; unknown surfaces refuse write execution.
   */
  slice: MutationSlice
  /** Absolute project directory that the execution will operate on. */
  projectRoot: string
  /** Absolute reviewed DeepSeek Harness source checkout. */
  harnessCheckout: string
  /** Absolute Ming Workbench checkout. */
  workbenchRoot: string
  provider?: string
  model?: string
  sessionRoot?: string
  /** Optional explicit project test command (default: `npm test`). */
  testCommand?: string[]
  /**
   * Explicit operator opt-in to perform a write mutation. Defaults to false so
   * the normal UI keeps execution disabled; an operator must enable it (e.g.
   * `MING_WORKBENCH_ALLOW_WRITE=1`). The reviewed Harness sandbox is preferred;
   * on platforms where an OS-level write sandbox cannot be enforced, this gate
   * is the safety rail that keeps bounded mutation off by default.
   */
  allowWrite?: boolean
  /**
   * Test/operational seam. Defaults to the real reviewed-Harness ACP runner.
   * Injected so the full Intake -> Authorize -> Execute -> Evidence chain can be
   * exercised without the reviewed bundle + network (e.g. a harness-run double
   * that performs a real mutation on the scratch project).
   */
  dependencies?: {
    runHarnessAcpGrant?: (options: HarnessAcpRunOptions) => Promise<HarnessAcpRunResult>
  }
}

export interface BoundedExecutionResult {
  workUnit: WorkUnit
  sessionId: string
  stopReason: string
  assistantText: string
  frontierDecision: ReturnType<typeof reconcileBeforeMutation>['decision']
  reconciliation: ReturnType<typeof reconcileBeforeMutation>
  repositoryReadback: RepositoryReadback
  /** P0-2: four separate status axes derived from real evidence only. */
  runOutcome: RunOutcome
}

export interface RepositoryReadback {
  changedFiles: string[]
  executionProducedChanges: string[]
  preExistingDirty: string[]
  scopeViolations: string[]
  testResult?: { passed: boolean; output: string }
  /** Real test outcome before the run started (pre-green no-op detection). */
  beforeTestResult?: { passed: boolean; output: string }
  gitStatus: string
}

export function validateExecutionPreconditions(options: BoundedExecutionOptions): void {
  assertHarnessExecutionGrant(options.grant)
  assertWorkbenchExecutionBinding(options.grant, options.binding, options.workUnit)

  if (options.workUnit.gate.open) {
    throw new Error(`Work Unit ${options.workUnit.id} has an open gate; cannot execute.`)
  }
  if (options.workUnit.state === 'completed') {
    throw new Error(`Work Unit ${options.workUnit.id} is already completed.`)
  }
  const target = options.grant.authorization.write_target
  if (!target) {
    throw new Error('grant has no write_target; cannot execute a bounded mutation.')
  }
  if (resolve(target.repository) !== resolve(options.projectRoot)) {
    throw new Error(
      `grant write_target.repository ${target.repository} does not match the fixed project ${options.projectRoot}.`,
    )
  }
  if (resolve(options.slice.repository) !== resolve(options.projectRoot)) {
    throw new Error(
      `mutation slice repository ${options.slice.repository} does not match the fixed project ${options.projectRoot}.`,
    )
  }
  // P0-1: an unknown file surface must block write execution before any
  // repository read or harness session.
  assertSliceAllowsWrite(options.slice)

  // P0-C write boundary: a write-authorized grant may only mutate files when the
  // operator has explicitly opted in. The reviewed Harness sandbox is preferred;
  // when an OS-level write sandbox cannot be guaranteed (e.g. Windows), this gate
  // is the safety rail that keeps bounded mutation OFF by default in the normal UI.
  if (options.grant.authorization.mutation_boundary === 'write-authorized' && options.allowWrite !== true) {
    throw new Error(
      'Bounded write execution is disabled; enable via MING_WORKBENCH_ALLOW_WRITE=1 or run inside the reviewed Harness sandbox.',
    )
  }
}

/**
 * Classify the execution outcome from real repository evidence, not Harness
 * chatter. P0-2: this is the four-axis classification
 * (RunStatus / EffectObservation / VerificationVerdict / AcceptanceVerdict).
 * Harness completion is only ever `RunStatus completed`.
 *
 * @deprecated use deriveRunOutcome from run-outcome.js (same contract).
 */
export function classifyExternalEffect(
  repositoryReadback: RepositoryReadback,
  grant: ProviderExecutionGrant,
): RunOutcome {
  const hasExternalEffects = grant.authorization.allowed_effects.some((effect) =>
    ['deploy', 'publish', 'payment', 'database-mutation', 'cloud-resource', 'production-api-post'].includes(effect),
  )
  return deriveRunOutcome({
    producedChanges: repositoryReadback.executionProducedChanges,
    scopeViolations: repositoryReadback.scopeViolations,
    testsPassedAfter: repositoryReadback.testResult?.passed,
    testsPassedBefore: repositoryReadback.beforeTestResult?.passed,
    hasExternalEffects,
  })
}

export async function runBoundedExecution(
  options: BoundedExecutionOptions,
): Promise<BoundedExecutionResult> {
  validateExecutionPreconditions(options)

  const workbenchRoot = resolve(options.workbenchRoot)
  const harnessCheckout = resolve(options.harnessCheckout)
  const projectRoot = resolve(options.projectRoot)

  // Step 1: real pre-mutation reconciliation against the live repository.
  const beforeSnapshot: RepositorySnapshot = readRepositorySnapshot(projectRoot)
  const reconciliation = reconcileBeforeMutation(
    beforeSnapshot,
    options.grant,
    options.slice,
  )
  if (!reconciliation.safeToStart) {
    throw new Error(`Execution blocked by repository frontier: ${reconciliation.reason}`)
  }

  // Step 1b: P0-2 — capture the REAL pre-execution test outcome so a pre-green
  // no-op run can never be mistaken for task success (regression A).
  const beforeTestResult = runProjectTests(projectRoot, options.testCommand)

  // Step 2: run the reviewed Harness ACP execution under the granted scope.
  const harnessRun = options.dependencies?.runHarnessAcpGrant ?? runHarnessAcpGrant
  const acpResult = await harnessRun({
    grant: options.grant,
    binding: options.binding,
    workUnit: options.workUnit,
    cwd: projectRoot,
    harnessCheckout,
    workbenchRoot,
    provider: options.provider,
    model: options.model,
    sessionRoot: options.sessionRoot,
  })

  // Step 3: read back the AFTER repository state.
  const afterSnapshot: RepositorySnapshot = readRepositorySnapshot(projectRoot)
  const delta = computeExecutionDelta(beforeSnapshot, afterSnapshot, options.slice)

  const repositoryReadback: RepositoryReadback = {
    changedFiles: delta.changedFiles,
    executionProducedChanges: delta.executionProducedChanges,
    preExistingDirty: delta.preExistingDirty,
    scopeViolations: delta.scopeViolations,
    gitStatus: delta.changedFiles.length > 0 ? 'modified' : 'clean',
  }

  // Step 4: run the project test command for real evidence (best effort).
  repositoryReadback.testResult = runProjectTests(projectRoot, options.testCommand)
  repositoryReadback.beforeTestResult = beforeTestResult

  // Step 5: classify the four status axes from real evidence. A Harness
  // session completing proves at most `runStatus: completed`; acceptance is
  // human-owned and never derived here (P0-2 regression C).
  const hasExternalEffects = options.grant.authorization.allowed_effects.some((effect) =>
    ['deploy', 'publish', 'payment', 'database-mutation', 'cloud-resource', 'production-api-post'].includes(effect),
  )
  let outcome = deriveRunOutcome({
    producedChanges: repositoryReadback.executionProducedChanges,
    scopeViolations: repositoryReadback.scopeViolations,
    testsPassedAfter: repositoryReadback.testResult?.passed,
    testsPassedBefore: beforeTestResult?.passed,
    hasExternalEffects,
  })

  // Step 6: unknown external effects must be reconciled before any retry.
  // `external-unknown` is never a retry permission; a confirming reconciler
  // upgrades it to `external-observed`.
  if (outcome.effect === 'external-unknown') {
    const reconciled = await reconcileExternalEffect('local-git', projectRoot, options.grant)
    if (reconciled.status === 'success') {
      outcome = {
        runStatus: 'completed',
        effect: 'external-observed',
        verification: 'inconclusive',
        acceptance: 'pending',
        reason: 'External effect reconciled: the target repository shows the expected changes.',
      }
    }
  }

  // Step 7: build the evidence-backed Work Unit update. The state mapping is
  // per-axis: only real mutation evidence + passed verification advances to
  // `verifying`; a completed run NEVER completes the Work Unit.
  const now = new Date().toISOString()
  const evidenceId = `EV-EXEC-${acpResult.sessionId}`

  const updatedWorkUnit: WorkUnit = {
    ...options.workUnit,
    state: workUnitStateForOutcome(outcome),
    gate: workUnitGateForOutcome(outcome),
    evidence: [
      ...options.workUnit.evidence,
      {
        id: evidenceId,
        kind: 'repository',
        // P0-3: the run record is a harness-session claim. It documents the
        // run but can never back Work Unit completion on its own.
        summary: `Harness session ${acpResult.stopReason}. Authorized surface: ${sliceScopeLabel(options.slice)}. Changes produced by this execution: ${repositoryReadback.executionProducedChanges.length}. Scope violations: ${repositoryReadback.scopeViolations.length}.`,
        uri: `deepseek-harness-acp:${acpResult.sessionId}`,
        observedAt: now,
        authoritative: false,
        verifier: 'harness-session',
        verification: 'pending',
      },
      {
        id: `EV-GIT-${acpResult.sessionId}`,
        kind: 'test',
        // P0-3: real test-run evidence carries the verification verdict.
        summary: repositoryReadback.testResult?.passed
          ? 'Project tests passed after execution (authoritative evidence).'
          : 'Project tests did not pass after execution.',
        observedAt: now,
        authoritative: true,
        verifier: 'test-run',
        verification: outcome.verification,
      },
    ],
    updatedAt: now,
  }

  return {
    workUnit: updatedWorkUnit,
    sessionId: acpResult.sessionId,
    stopReason: acpResult.stopReason,
    assistantText: acpResult.assistantText,
    frontierDecision: reconciliation.decision,
    reconciliation,
    repositoryReadback,
    runOutcome: outcome,
  }
}

/** P0-2: Work Unit state is driven by the separated axes, never by a boolean. */
function workUnitStateForOutcome(outcome: RunOutcome): WorkUnit['state'] {
  if (outcome.effect === 'external-unknown') return 'blocked'
  if (outcome.effect === 'no-mutation') {
    // Pre-green no-op runs must go back to the human, not look completed.
    return outcome.verification === 'inconclusive' ? 'needs-human' : 'blocked'
  }
  // mutation-observed / external-observed
  return outcome.verification === 'failed' ? 'blocked' : 'verifying'
}

function workUnitGateForOutcome(outcome: RunOutcome): WorkUnit['gate'] {
  if (outcome.effect === 'external-unknown') {
    return {
      kind: 'external-wait',
      open: true,
      summary: `External effect outcome unknown: ${outcome.reason}`,
      owner: 'external',
    }
  }
  if (outcome.effect === 'no-mutation' && outcome.verification === 'inconclusive') {
    return {
      kind: 'human-decision',
      open: true,
      summary: outcome.reason,
      owner: 'human',
    }
  }
  if (outcome.verification === 'failed') {
    return { kind: 'safety', open: true, summary: outcome.reason, owner: 'agent' }
  }
  return { kind: 'none', open: false }
}

function runProjectTests(
  projectRoot: string,
  testCommand?: string[],
): RepositoryReadback['testResult'] {
  // npm resolves through a .cmd shim on Windows; route the default command
  // through cmd.exe (the shim cannot be spawned directly by execFileSync).
  // Explicit custom test commands stay shell-free.
  const needsShell = testCommand === undefined && process.platform === 'win32'
  const command = testCommand ?? ['npm', 'test']
  const [file, args] = needsShell
    ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm test']]
    : [command[0], command.slice(1)]
  // The outer node:test runner propagates NODE_TEST_CONTEXT to children; a
  // nested `node --test` under that context exits 0 with empty output and
  // silently swallows every failure. A spawned project test must run in a
  // fresh runner context so its exit code is real evidence.
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  try {
    const output = execFileSync(file, args, {
      encoding: 'utf8',
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
      env,
    }).trim()
    // The exit code is the authoritative pass/fail signal (execFileSync throws
    // on non-zero). Output text is not scanned: runners print "fail 0" even on
    // green runs.
    return { passed: true, output }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      passed: false,
      output: `Test execution failed or timed out: ${message}`,
    }
  }
}
