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
  type ExternalEffectOutcome,
  type ExternalEffectStatus,
} from './repository.js'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

export interface BoundedExecutionOptions {
  /** Authoritative Work Unit resolved from the backend store, never browser-supplied. */
  workUnit: WorkUnit
  /** AAOP-schema grant resolved from the backend store, never browser-supplied. */
  grant: ProviderExecutionGrant
  /** Workbench-owned correlation resolved from the backend store. */
  binding: WorkbenchExecutionBinding
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
  /** Intended file surface for frontier overlap detection. */
  intendedFiles?: string[]
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
  effectOutcome: ExternalEffectOutcome
}

export interface RepositoryReadback {
  changedFiles: string[]
  executionProducedChanges: string[]
  preExistingDirty: string[]
  scopeViolations: string[]
  testResult?: { passed: boolean; output: string }
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

/** Classify the execution outcome from real repository evidence, not Harness chatter. */
export function classifyExternalEffect(
  repositoryReadback: RepositoryReadback,
  grant: ProviderExecutionGrant,
): ExternalEffectOutcome {
  const hasExternalEffects = grant.authorization.allowed_effects.some((effect) =>
    ['deploy', 'publish', 'payment', 'database-mutation', 'cloud-resource', 'production-api-post'].includes(effect),
  )

  // Scope violations are always a hard failure regardless of effect type.
  if (repositoryReadback.scopeViolations.length > 0) {
    return {
      status: 'failure',
      reason: `Execution changed files outside the granted scope: ${repositoryReadback.scopeViolations.join(', ')}.`,
      retryable: false,
    }
  }

  // Local operations succeed only when THIS execution produced changes or tests pass.
  // Pre-existing dirty files never count as success.
  const producedChange = repositoryReadback.executionProducedChanges.length > 0
  const testsPassed = repositoryReadback.testResult?.passed === true

  if (!hasExternalEffects) {
    if (producedChange || testsPassed) {
      return {
        status: 'success',
        reason: producedChange
          ? `Local repository changes produced by this execution: ${repositoryReadback.executionProducedChanges.join(', ')}.`
          : 'Project tests passed after execution.',
        retryable: false,
      }
    }
    return {
      status: 'failure',
      reason: 'No repository changes were produced by this execution and tests did not pass.',
      retryable: false,
    }
  }

  // External effects: Harness completion is activity evidence, not acceptance.
  // We cannot know the external outcome from local state, so it is unknown and
  // must be reconciled before any retry.
  return {
    status: 'unknown',
    reason: 'Harness completed but the external effect outcome is unknown and must be reconciled.',
    retryable: false,
  }
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
    options.intendedFiles ?? [],
  )
  if (!reconciliation.safeToStart) {
    throw new Error(`Execution blocked by repository frontier: ${reconciliation.reason}`)
  }

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
  const delta = computeExecutionDelta(beforeSnapshot, afterSnapshot, projectRoot)

  const repositoryReadback: RepositoryReadback = {
    changedFiles: delta.changedFiles,
    executionProducedChanges: delta.executionProducedChanges,
    preExistingDirty: delta.preExistingDirty,
    scopeViolations: delta.scopeViolations,
    gitStatus: delta.changedFiles.length > 0 ? 'modified' : 'clean',
  }

  // Step 4: run the project test command for real evidence (best effort).
  repositoryReadback.testResult = runProjectTests(projectRoot, options.testCommand)

  // Step 5: classify outcome from real evidence.
  const effectOutcome = classifyExternalEffect(repositoryReadback, options.grant)

  // Step 6: unknown external effects must be reconciled before any retry.
  // `unknown` is never a retry permission.
  let finalOutcome = effectOutcome
  if (effectOutcome.status === 'unknown') {
    const reconciled = await reconcileExternalEffect('local-git', projectRoot, options.grant)
    if (reconciled.status === 'success') {
      finalOutcome = { ...reconciled, status: 'success' }
    }
  }

  // Step 7: build the evidence-backed Work Unit update.
  const now = new Date().toISOString()
  const evidenceId = `EV-EXEC-${acpResult.sessionId}`

  const updatedWorkUnit: WorkUnit = {
    ...options.workUnit,
    state: finalOutcome.status === 'success' ? 'verifying' : finalOutcome.status === 'unknown' ? 'blocked' : 'blocked',
    gate: finalOutcome.status === 'unknown'
      ? {
          kind: 'external-wait',
          open: true,
          summary: `External effect outcome unknown: ${finalOutcome.reason}`,
          owner: 'external',
        }
      : finalOutcome.status === 'success'
        ? { kind: 'none', open: false }
        : { kind: 'safety', open: true, summary: finalOutcome.reason, owner: 'agent' },
    evidence: [
      ...options.workUnit.evidence,
      {
        id: evidenceId,
        kind: 'repository',
        summary: `Harness session ${acpResult.stopReason}. Changes produced by this execution: ${repositoryReadback.executionProducedChanges.length}. Scope violations: ${repositoryReadback.scopeViolations.length}.`,
        uri: `deepseek-harness-acp:${acpResult.sessionId}`,
        observedAt: now,
        authoritative: false,
      },
      {
        id: `EV-GIT-${acpResult.sessionId}`,
        kind: 'test',
        summary: repositoryReadback.testResult?.passed
          ? 'Project tests passed after execution (authoritative evidence).'
          : 'Project tests did not pass after execution.',
        observedAt: now,
        authoritative: true,
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
    effectOutcome: finalOutcome,
  }
}

function runProjectTests(
  projectRoot: string,
  testCommand?: string[],
): RepositoryReadback['testResult'] {
  const command = testCommand ?? ['npm', 'test']
  try {
    const output = execFileSync(command[0], command.slice(1), {
      encoding: 'utf8',
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    }).trim()
    return {
      passed: !output.includes('fail') && !output.includes('Error') && !output.includes('FAIL'),
      output,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      passed: false,
      output: `Test execution failed or timed out: ${message}`,
    }
  }
}
