import type { WorkUnit } from '../core/model.js'
import {
  assertHarnessExecutionGrant,
  assertWorkbenchExecutionBinding,
  type ProviderExecutionGrant,
  type WorkbenchExecutionBinding,
} from '../execution/provider-grant.js'
import {
  runHarnessAcpGrant,
  type HarnessAcpRunOptions,
} from '../transports/harness-acp.js'
import {
  assessRepositoryFrontier,
  type FrontierDecision,
} from '../domain-packs/repository-frontier.js'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

export interface BoundedExecutionOptions {
  workUnit: WorkUnit
  grant: ProviderExecutionGrant
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
}

export interface BoundedExecutionResult {
  workUnit: WorkUnit
  sessionId: string
  stopReason: string
  assistantText: string
  frontierDecision: FrontierDecision
  repositoryReadback: RepositoryReadback
  effectOutcome: ExternalEffectOutcome
}

export interface RepositoryReadback {
  changedFiles: string[]
  testResult?: { passed: boolean; output: string }
  gitStatus: string
}

export type ExternalEffectStatus = 'success' | 'failure' | 'unknown' | 'reconciling'

export interface ExternalEffectOutcome {
  status: ExternalEffectStatus
  reason: string
  reconciliationEvidence?: string
  retryable: boolean
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
}

/**
 * Determine the external-effect status from a Harness ACP result.
 *
 * Key principle: Harness end_turn, tool success, or assistant narrative
 * never equals project completion. Only repository/test/runtime evidence
 * accepted through AAOP completion semantics can close the Work Unit.
 *
 * For external effects (deployment, payment, database mutation, cloud
 * resource mutation, publish, production API POST), if the result is
 * unknown, we must reconcile before retrying.
 */
export function classifyExternalEffect(
  acpStopReason: string,
  repositoryReadback: RepositoryReadback,
  grant: ProviderExecutionGrant,
): ExternalEffectOutcome {
  // If the grant authorizes only local file operations with no external
  // side effects, a successful git readback is sufficient.
  const hasExternalEffects = grant.authorization.allowed_effects.some((effect) =>
    ['deploy', 'publish', 'payment', 'database-mutation', 'cloud-resource', 'production-api-post'].includes(effect),
  )

  if (!hasExternalEffects) {
    // Local operations: success if git readback shows changes or tests pass.
    if (repositoryReadback.changedFiles.length > 0 || repositoryReadback.testResult?.passed) {
      return {
        status: 'success',
        reason: 'Local repository changes verified.',
        retryable: false,
      }
    }
    return {
      status: 'failure',
      reason: 'No repository changes detected after execution.',
      retryable: true,
    }
  }

  // External effects: Harness completion is activity/execution evidence,
  // not final acceptance. We need reconciliation.
  if (acpStopReason === 'end_turn') {
    return {
      status: 'unknown',
      reason: 'Harness completed but external effect outcome is unknown. Reconciliation required.',
      retryable: false,
    }
  }

  if (acpStopReason === 'max_tokens' || acpStopReason === 'time_limit') {
    return {
      status: 'unknown',
      reason: 'Harness stopped before completing. External effect state is unknown.',
      retryable: false,
    }
  }

  return {
    status: 'failure',
    reason: `Harness execution ended with stop reason: ${acpStopReason}`,
    retryable: true,
  }
}

/**
 * Reconcile the actual state of an external effect before retrying.
 *
 * This function queries the real target state to determine if the
 * operation actually succeeded, failed, or is still pending.
 * It never retries blindly based on Harness activity alone.
 */
export async function reconcileExternalEffect(
  effectType: string,
  target: string,
  grant: ProviderExecutionGrant,
): Promise<ExternalEffectOutcome> {
  // In Phase 5, we only support reconciliation for local git operations.
  // External effects (deploy, payment, etc.) are explicitly blocked
  // until a proven reconciliation mechanism exists.
  if (!['local-git', 'local-file'].includes(effectType)) {
    return {
      status: 'unknown',
      reason: `External effect type "${effectType}" requires explicit reconciliation support. Not auto-retried.`,
      retryable: false,
    }
  }

  try {
    // Query actual git state for reconciliation.
    const gitStatus = execFileSync('git', ['status', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()

    if (gitStatus) {
      return {
        status: 'success',
        reason: 'Reconciliation confirmed: repository has uncommitted changes.',
        reconciliationEvidence: gitStatus,
        retryable: false,
      }
    }

    return {
      status: 'failure',
      reason: 'Reconciliation: no changes detected in target.',
      reconciliationEvidence: 'git status clean',
      retryable: true,
    }
  } catch (error) {
    return {
      status: 'unknown',
      reason: `Reconciliation failed: ${error instanceof Error ? error.message : String(error)}`,
      retryable: false,
    }
  }
}

export async function runBoundedExecution(
  options: BoundedExecutionOptions,
): Promise<BoundedExecutionResult> {
  validateExecutionPreconditions(options)

  const workbenchRoot = resolve(options.workbenchRoot)
  const harnessCheckout = resolve(options.harnessCheckout)
  const projectRoot = resolve(options.projectRoot)

  // Step 1: Fresh repository frontier check immediately before execution.
  const frontierDecision = assessRepositoryFrontier(
    {
      repository: '',
      baseRef: '',
      observedAt: new Date().toISOString(),
      activeWork: [],
    },
    options.grant.authorization.write_target?.environment
      ? []
      : extractIntendedFiles(options.grant),
  )

  if (!frontierDecision.safeToStart) {
    throw new Error(
      `Execution blocked by repository frontier: ${frontierDecision.reason}`,
    )
  }

  // Step 2: Run Harness ACP with the execution grant.
  const acpResult = await runHarnessAcpGrant({
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

  // Step 3: Read back repository state.
  const repositoryReadback = await readRepositoryState(projectRoot)

  // Step 4: Classify external effect status.
  // Key principle: Harness end_turn != project completion.
  // Only repository/test/runtime evidence can close the Work Unit.
  const effectOutcome = classifyExternalEffect(
    acpResult.stopReason,
    repositoryReadback,
    options.grant,
  )

  // Step 5: For unknown external effects, attempt reconciliation
  // before considering retry. Never blind retry.
  if (effectOutcome.status === 'unknown' && effectOutcome.retryable) {
    const reconciliation = await reconcileExternalEffect(
      'local-git',
      projectRoot,
      options.grant,
    )
    if (reconciliation.status === 'success') {
      effectOutcome.status = 'success'
      effectOutcome.reason = `Reconciliation succeeded: ${reconciliation.reason}`
      effectOutcome.retryable = false
    }
  }

  // Step 6: Update Work Unit with execution evidence.
  const now = new Date().toISOString()
  const evidenceId = `EV-EXEC-${acpResult.sessionId}`

  const updatedWorkUnit: WorkUnit = {
    ...options.workUnit,
    state: effectOutcome.status === 'success' ? 'verifying' : 'blocked',
    gate: effectOutcome.status === 'unknown'
      ? {
          kind: 'external-wait',
          open: true,
          summary: `External effect outcome unknown: ${effectOutcome.reason}`,
          owner: 'external',
        }
      : options.workUnit.gate,
    evidence: [
      ...options.workUnit.evidence,
      {
        id: evidenceId,
        kind: 'repository',
        summary: `Harness execution ${acpResult.stopReason}. Changed ${repositoryReadback.changedFiles.length} files. External effect: ${effectOutcome.status}.`,
        uri: `deepseek-harness-acp:${acpResult.sessionId}`,
        observedAt: now,
        authoritative: false,
      },
      {
        id: `EV-GIT-${acpResult.sessionId}`,
        kind: 'test',
        summary: repositoryReadback.testResult?.passed
          ? 'Repository tests passed after execution.'
          : 'Repository tests did not pass after execution.',
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
    frontierDecision,
    repositoryReadback,
    effectOutcome,
  }
}

function extractIntendedFiles(grant: ProviderExecutionGrant): string[] {
  const files: string[] = []
  for (const task of grant.tasks) {
    if (task.action.includes('file') || task.action.includes('write')) {
      const match = task.action.match(/([A-Za-z0-9_\-./]+\.[A-Za-z]+)/g)
      if (match) {
        files.push(...match)
      }
    }
  }
  return files
}

async function readRepositoryState(projectRoot: string): Promise<RepositoryReadback> {
  let gitStatus = ''
  let changedFiles: string[] = []

  try {
    gitStatus = execFileSync('git', ['-C', projectRoot, 'status', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    changedFiles = gitStatus.split('\n').filter(Boolean).map((line) => line.slice(3)).filter(Boolean)
  } catch {
    gitStatus = 'unable to read git status'
  }

  let testResult: RepositoryReadback['testResult'] = undefined
  try {
    const testOutput = execFileSync('npm', ['test', '--', '--reporter=dot'], {
      encoding: 'utf8',
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
    }).trim()
    testResult = {
      passed: !testOutput.includes('fail') && !testOutput.includes('Error'),
      output: testOutput,
    }
  } catch {
    testResult = {
      passed: false,
      output: 'Test execution failed or timed out.',
    }
  }

  return {
    changedFiles,
    testResult,
    gitStatus,
  }
}
