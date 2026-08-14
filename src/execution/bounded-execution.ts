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
}

export interface RepositoryReadback {
  changedFiles: string[]
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

  // Step 4: Update Work Unit with execution evidence.
  const now = new Date().toISOString()
  const evidenceId = `EV-EXEC-${acpResult.sessionId}`

  const updatedWorkUnit: WorkUnit = {
    ...options.workUnit,
    state: 'verifying',
    evidence: [
      ...options.workUnit.evidence,
      {
        id: evidenceId,
        kind: 'repository',
        summary: `Harness execution completed. Changed ${repositoryReadback.changedFiles.length} files.`,
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
