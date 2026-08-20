/**
 * First-outcome executor — the product layer that takes a CONFIRMED
 * human-first idea and drives it through the existing AAOP -> Harness ->
 * bounded-execution -> ordinary evidence chain into a real result.
 *
 * This is the "confirmed -> execute" bridge reachable from the real product
 * (the standalone stage3 slice is its script-level rehearsal). It deliberately
 * reuses the reviewed execution chain; it re-implements nothing.
 *
 * Two execution modes, both over the SAME real chain:
 *
 *   - deterministic (CI): `MING_EXECUTION_FIXTURE=1` drives the real
 *     transport/AAOP/isolation with a repository-owned fixture provider so the
 *     whole chain is exercised on every run. Marked DETERMINISTIC, never REAL.
 *   - real: the provider env that ALREADY reached this process from
 *     safeStorage via the desktop shell (DEEPSEEK_API_KEY / base URL / model)
 *     is honoured end-to-end. This is the founder's own-key path: the SAME
 *     provider that understood the conversation now does the execution.
 *
 * Real execution is ONLY permitted when the caller passed explicit human
 * authorization (the cost gate). Without it, this returns the honest
 * projection for the sub-kind that still needs the human gate.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { HumanFirstIdea } from '../idea/idea-space.js'
import { bridgeConfirmedIdeaToExecution } from '../bridge/confirmed-to-execution.js'
import { compileExecutableGoal, type ExecutableGoal } from '../execution/executable-goal.js'
import { routeForConfirmedIdea, type RouteDecision } from '../execution/execution-route.js'
import { projectOutcomeFromRun, type ProjectOutcome } from '../outcome/project-outcome.js'
import type { RunOutcome } from '../execution/run-outcome.js'
import { prepareProjectDevelopmentIntake } from '../intake/project-aaop.js'
import type { WorkbenchProjectManifest } from '../projects/manifest.js'
import { runProjectAaopCoordinator } from '../intake/coordinator.js'
import { readRepositorySnapshot } from '../execution/repository.js'
import { proposeMutationScope } from '../execution/scope-proposal.js'
import { buildExactSlice } from '../execution/mutation-slice.js'
import { issueProviderExecutionGrant } from '../execution/grant-issuance.js'
import { runBoundedExecution } from '../execution/bounded-execution.js'

export type FirstOutcomeMode = 'fixture' | 'real'

export interface FirstOutcomeExecutorOptions {
  /** The confirmed idea to execute. */
  idea: HumanFirstIdea
  /** Absolute Ming Workbench checkout root (for `.tmp`, bundled harness, etc.). */
  workbenchRoot: string
  /** Parent directory that will hold the Workbench-owned idea workspace. */
  workspaceRoot: string
  /** Absolute reviewed DeepSeek Harness checkout. */
  harnessCheckout: string
  /** Provider transport selected (e.g. `deepseek-official`). */
  provider: string
  /** Model name for execution (from preferences). */
  model: string
  sessionRoot?: string
  now?: () => Date
  idFactory?: () => string
  /** Execution mode. `fixture` must only ever be used by automated CI. */
  mode: FirstOutcomeMode
  /** The human cost-gate authorization (required for `mode: 'real'`). */
  authorizeRealExecution?: boolean
}

export interface FirstOutcomeResult {
  /** The execution mode actually honored (fixture is never "real"). */
  mode: FirstOutcomeMode
  route: RouteDecision
  goal: ExecutableGoal
  outcome: ProjectOutcome
  runOutcome?: RunOutcome
  workUnitId?: string
  workUnitState?: string
  /** Files produced by execution (real repository readback). */
  producedFiles: string[]
  /** Absolute path to the primary result artifact (openable), if any. */
  artifactPath?: string
  /** Absolute path to the Workbench-owned idea workspace. */
  workspacePath: string
  /** Honest human summary of this round. */
  summary: string
  /** Facts independently verified. */
  verifiedFacts: string[]
  /** Facts NOT yet proven. */
  notProvenFacts: string[]
  /** Internal reason / detail (for the collapsed technical detail). */
  detail: string
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

/** Deterministic AAOP bridge manifest (the same shape the reviewed slice uses). */
function aaopManifest(nodeBin: string): WorkbenchProjectManifest {
  return {
    schema_version: '1.0',
    project: {
      id: 'first-outcome',
      title: 'First Outcome',
      domain_pack: 'development-aaop',
    },
    development: {
      aaop_bridge: {
        ready: { command: nodeBin, args: ['-e', "console.log('AAOP READY')"], timeoutMs: 10_000 },
        status: { command: nodeBin, args: ['-e', "console.log(JSON.stringify({stage:'development'}))"], timeoutMs: 10_000 },
        prompt: { command: nodeBin, args: ['-e', "console.log('Inspect repository evidence read-only and derive AAOP canonical Developer Intake.')"], timeoutMs: 10_000 },
      },
    },
  }
}

function ideaSlug(id: string): string {
  const clean = id.replace(/[^a-zA-Z0-9-_]+/g, '-').replace(/^[-_]+|[-_]+$/g, '')
  return clean || 'idea'
}

export async function executeFirstOutcome(
  options: FirstOutcomeExecutorOptions,
): Promise<FirstOutcomeResult> {
  const { idea, workbenchRoot, workspaceRoot, harnessCheckout, provider, model } = options
  const now = options.now ?? (() => new Date())
  const idFactory = options.idFactory ?? (() => `wo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)

  if (idea.stage !== 'confirmed' || !idea.agreement || !idea.synthesis) {
    throw new Error('Cannot execute an idea that is not confirmed with an agreement.')
  }
  if (options.mode === 'real' && options.authorizeRealExecution !== true) {
    throw new Error('Real execution requires explicit human authorization (cost gate).')
  }

  const route = routeForConfirmedIdea(idea)
  const goal = compileExecutableGoal(idea)

  if (route.route === 'unsupported') {
    return {
      mode: options.mode,
      route,
      goal,
      outcome: {
        status: 'unsupported',
        summary: '这一类结果，我现在还不能真正替你完成。',
        detail: `当前 Execution Route：${route.reason}`,
      },
      producedFiles: [],
      workspacePath: '',
      summary: '这一类结果，我现在还不能真正替你完成。',
      verifiedFacts: [],
      notProvenFacts: ['这一轮的目标类型暂不支持真实执行，因此没有产生任何成果。'],
      detail: route.reason,
    }
  }

  // 1. Workbench-owned workspace with a real git baseline (hidden from UI).
  const dirName = `${ideaSlug(idea.id)}-${now().toISOString().slice(0, 10)}`
  const workspacePath = join(workspaceRoot, dirName)
  mkdirSync(workspacePath, { recursive: true })
  runGit(workspacePath, ['init', '-q'])
  runGit(workspacePath, ['config', 'user.email', 'workbench@local.test'])
  runGit(workspacePath, ['config', 'user.name', 'Ming Workbench'])
  writeFileSync(
    join(workspacePath, 'README.md'),
    `# ${goal.goalStatement}\n\n## 这一轮\n\n${goal.acceptanceCriteria.join('\n')}\n\nWorkbench-owned first outcome workspace. 由 Ming Workbench 自动创建。\n`,
  )
  writeFileSync(join(workspacePath, 'index.html'), '<!-- workbench first outcome placeholder -->\n')
  runGit(workspacePath, ['add', '.'])
  runGit(workspacePath, ['commit', '-qm', 'init: workbench first-outcome baseline'])

  // 2. bridge -> Work Unit (reuses the existing intake factory).
  const bridged = bridgeConfirmedIdeaToExecution(idea, {
    spaceId: `SPACE-${ideaSlug(idea.id)}`,
    now,
    idFactory,
  })
  if (bridged.status !== 'software-execution') {
    throw new Error(`unexpected bridge status: ${bridged.status}`)
  }
  let workUnit = bridged.workUnit

  // 3. AAOP Developer Intake (real read-only ACP session).
  const manifest = aaopManifest(process.execPath)
  const prepared = prepareProjectDevelopmentIntake({
    rawRequest: bridged.goal.goalStatement,
    projectRoot: workspacePath,
    spaceId: workUnit.spaceId,
    trustedProject: true,
    manifest,
    now,
    idFactory,
  })
  if (prepared.status !== 'ready-for-aaop-coordinator') {
    throw new Error(`project bridge did not become coordinator-ready: ${prepared.reason ?? prepared.status}`)
  }
  const intake = await runProjectAaopCoordinator({
    prepared,
    projectRoot: workspacePath,
    harnessCheckout,
    workbenchRoot,
    provider,
    model,
    sessionRoot: options.sessionRoot,
    now,
  })
  workUnit = intake.workUnit

  // 4. mutation scope proposal -> frozen exact slice.
  const snapshot = readRepositorySnapshot(workspacePath)
  const proposal = proposeMutationScope({
    projectRoot: workspacePath,
    rawRequest: bridged.goal.goalStatement,
    intakeEvidence: intake.envelope.project_evidence_summary,
    nextAction: intake.envelope.next_action,
    route: intake.envelope.route,
  })
  const targetPaths = proposal.items.map((item) => item.path)
  const slice = buildExactSlice(workspacePath, snapshot.head, targetPaths)

  // 5. AAOP canonical Provider Execution Grant.
  const { grant, binding } = issueProviderExecutionGrant({
    workUnit,
    projectRoot: workspacePath,
    snapshot,
    slice,
    now,
  })

  // 6. bounded execution (real ACP write inside the isolation, apply-back only
  //    the authorized + verified delta). `allowWrite:true` reflects that a
  //    confirmed idea + explicit grant has already passed the human gate.
  const result = await runBoundedExecution({
    workUnit,
    grant,
    binding,
    slice,
    projectRoot: workspacePath,
    harnessCheckout,
    workbenchRoot,
    provider,
    model,
    sessionRoot: options.sessionRoot,
    allowWrite: true,
  })
  workUnit = result.workUnit

  // 7. ordinary outcome projection + honest human result surface.
  const projected = projectOutcomeFromRun(result.runOutcome)
  const producedFiles =
    result.repositoryReadback.executionProducedChanges || result.appliedBack || []
  const primaryArtifact = ['index.html', 'index.htm'].find((name) =>
    existsSync(join(workspacePath, name)),
  )

  let verifiedFacts: string[]
  let notProvenFacts: string[]
  if (result.runOutcome.verification === 'passed' && result.runOutcome.effect === 'mutation-observed') {
    verifiedFacts = [
      `执行确实产生了文件改动：${producedFiles.join('、') || '无'}`,
      `改动没有超出本轮约定的范围。`,
      `还没有被独立验证的部分已如实列出。`,
    ]
    notProvenFacts = [`这个成果是否真的像你想的那样好用，还需要你亲自打开、使用、确认。`]
  } else {
    verifiedFacts = []
    notProvenFacts = [
      `执行没有产出可用的成果，或还缺少独立验证。`,
      projected.detail,
    ]
  }

  return {
    mode: options.mode,
    route,
    goal,
    outcome: projected,
    runOutcome: result.runOutcome,
    workUnitId: workUnit.id,
    workUnitState: workUnit.state,
    producedFiles,
    artifactPath: primaryArtifact ? join(workspacePath, primaryArtifact) : undefined,
    workspacePath,
    summary: projected.summary,
    verifiedFacts,
    notProvenFacts,
    detail: projected.detail,
  }
}