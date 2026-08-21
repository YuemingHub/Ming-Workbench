/**
 * The first complete closed loop.
 *
 * Human Intent → Workbench Outcome → AAOP Intake → Harness Execution → Reality
 * Change → Evidence Return.
 *
 * The loop is a linear sequence of already-existing real functions. What this
 * orchestrator adds is the wiring that connects the confirmed HumanFirstIdea —
 * which nothing downstream consumed before — all the way through to the
 * evidence return the confirming human receives, under one traceable
 * ExecutionRun. It is not a workflow engine: there is no branching, retry, or
 * scheduling here, and it persists nothing of its own (the Work Unit remains
 * the single source of truth). Every step delegates to a real upstream
 * function; only the two LLM transport sessions may be replaced through the
 * official injection seams (`dependencies.runCoordinator`,
 * `dependencies.runHarnessAcpGrant`).
 *
 * The loop deliberately stops at verification, not completion: a bounded
 * execution that produces a real, scope-clean, verified mutation yields
 * `verification: 'passed'` and `acceptance: 'pending'` — acceptance is
 * human-owned and is never claimed by the loop itself.
 */

import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { HumanFirstIdea } from '../idea/idea-space.js'
import type { WorkUnit } from '../core/model.js'
import type { ProjectOnboardingResult } from '../projects/onboarding.js'
import type { PreparedProjectIntake, PrepareProjectIntakeOptions } from '../intake/project-aaop.js'
import type { AaopCoordinatorResult, RunAaopCoordinatorOptions } from '../intake/coordinator.js'
import type { ProviderExecutionGrant } from './provider-grant.js'
import type { BoundedExecutionResult } from './bounded-execution.js'
import type { HarnessAcpRunOptions, HarnessAcpRunResult } from '../transports/harness-acp.js'
import type { ExecutionRun } from './execution-run.js'
import type { EvidenceReturn } from './evidence-projection.js'

import { adaptConfirmedIdeaToIntakeOptions } from '../intake/outcome-adapter.js'
import { resolveProjectOnboarding } from '../projects/onboarding.js'
import { prepareProjectDevelopmentIntake } from '../intake/project-aaop.js'
import { runProjectAaopCoordinator } from '../intake/coordinator.js'
import { readRepositorySnapshot } from './repository.js'
import { buildExactSlice } from './mutation-slice.js'
import { issueProviderExecutionGrant } from './grant-issuance.js'
import { runBoundedExecution } from './bounded-execution.js'
import { projectEvidenceReturn } from './evidence-projection.js'
import { buildExecutionRun } from './execution-run.js'

export interface ClosedLoopProject {
  projectRoot: string
  trustedProject: boolean
}

export interface ClosedLoopDependencies {
  resolveOnboarding?: (projectRoot: string, deps: { workbenchRoot?: string }) => ProjectOnboardingResult
  prepareProjectIntake?: (options: PrepareProjectIntakeOptions) => PreparedProjectIntake
  runCoordinator?: (options: RunAaopCoordinatorOptions) => Promise<AaopCoordinatorResult>
  runHarnessAcpGrant?: (options: HarnessAcpRunOptions) => Promise<HarnessAcpRunResult>
}

export interface RunFirstClosedLoopOptions {
  idea: HumanFirstIdea
  project: ClosedLoopProject
  harnessCheckout: string
  workbenchRoot: string
  /** The single file the human authorized for this bounded mutation (e.g. 'README.md'). */
  authorizedFile: string
  provider?: string
  model?: string
  sessionRoot?: string
  now?: () => Date
  idFactory?: () => string
  dependencies?: ClosedLoopDependencies
}

export type ClosedLoopResult =
  | { status: 'setup-required' | 'blocked' | 'needs-human'; workUnit: WorkUnit; reason: string }
  | { status: 'completed'; executionRun: ExecutionRun; evidenceReturn: EvidenceReturn }

/**
 * Run the first complete closed loop end to end. Returns either a human-owned
 * gate (setup/blocked/needs-human) or the completed loop's ExecutionRun and
 * Evidence Return.
 */
export async function runFirstClosedLoop(
  options: RunFirstClosedLoopOptions,
): Promise<ClosedLoopResult> {
  const now = options.now ?? (() => new Date())
  const idFactory = options.idFactory ?? (() => randomUUID())
  const deps = options.dependencies ?? {}
  const workbenchRoot = resolve(options.workbenchRoot)
  const projectRoot = resolve(options.project.projectRoot)

  // 1. Workbench Outcome → AAOP Intake raw request.
  const intakeOptions = adaptConfirmedIdeaToIntakeOptions(options.idea, options.project)

  // 2. Real read-only project onboarding discovery.
  const onboarding = (deps.resolveOnboarding ?? resolveProjectOnboarding)(projectRoot, {
    workbenchRoot,
  })
  if (onboarding.status === 'setup-required' || onboarding.status === 'blocked') {
    return {
      status: onboarding.status,
      workUnit: stubWorkUnit(intakeOptions.rawRequest, 'SPACE-stub', now, idFactory, onboarding.reason),
      reason: onboarding.reason,
    }
  }
  const spaceId = `SPACE-${onboarding.project.id}`

  // 3. Real grounded Developer Intake preparation (runs the real project AAOP bridge).
  const prepare = deps.prepareProjectIntake ?? prepareProjectDevelopmentIntake
  const prepared = prepare({
    rawRequest: intakeOptions.rawRequest,
    projectRoot,
    spaceId,
    trustedProject: options.project.trustedProject,
    manifest: onboarding.manifest,
    now,
    idFactory,
  })
  if (prepared.status !== 'ready-for-aaop-coordinator') {
    return {
      status: 'blocked',
      workUnit: prepared.workUnit,
      reason: prepared.reason,
    }
  }

  // 4. AAOP Intake coordinator (real preparation + reconciliation; the LLM
  //    session is the only seam that may be doubled).
  const coordinate = deps.runCoordinator ?? runProjectAaopCoordinator
  const intake = await coordinate({
    prepared,
    projectRoot,
    harnessCheckout: options.harnessCheckout,
    workbenchRoot,
    provider: options.provider,
    model: options.model,
    sessionRoot: options.sessionRoot,
    now,
  })

  // A genuinely human-owned question gates the loop before any authorization.
  if (intake.workUnit.gate.open) {
    return {
      status: 'needs-human',
      workUnit: intake.workUnit,
      reason: intake.workUnit.nextFrontier ?? 'A human-owned decision gates this Work Unit.',
    }
  }

  // 5. Real repository snapshot + the human-authorized exact mutation slice.
  const snapshot = readRepositorySnapshot(projectRoot)
  const slice = buildExactSlice(projectRoot, snapshot.head, [options.authorizedFile])

  // 6. Real Provider Execution Grant issuance (server-side, AAOP-schema).
  //    The grant keeps its own `GRANT-` id convention; the loop's idFactory is
  //    for run/work-unit correlation, not for overriding the grant prefix.
  const { grant, binding } = issueProviderExecutionGrant({
    workUnit: intake.workUnit,
    projectRoot,
    snapshot,
    slice,
    now,
  })

  // 7. Real bounded execution inside a disposable git isolation. The Harness
  //    grant session is the only seam that may be doubled; isolation, delta,
  //    readback, run-outcome, and evidence all run for real.
  const execution = await runBoundedExecution({
    workUnit: intake.workUnit,
    grant,
    binding,
    slice,
    projectRoot,
    harnessCheckout: options.harnessCheckout,
    workbenchRoot,
    provider: options.provider,
    model: options.model,
    sessionRoot: options.sessionRoot,
    allowWrite: true,
    dependencies: deps.runHarnessAcpGrant
      ? { runHarnessAcpGrant: deps.runHarnessAcpGrant }
      : undefined,
  })

  // 8. Evidence Return projection (reality change + authoritative evidence).
  const evidenceReturn = projectEvidenceReturn({
    execution,
    ideaId: options.idea.id,
    grant,
  })

  // 9. Correlate the four real artifacts under one traceable ExecutionRun.
  const executionRun = buildExecutionRun({
    ideaId: options.idea.id,
    intake,
    grant: grant as ProviderExecutionGrant,
    execution,
    now,
    idFactory,
  })

  return { status: 'completed', executionRun: executionRun as ExecutionRun, evidenceReturn }
}

function stubWorkUnit(
  rawRequest: string,
  spaceId: string,
  now: () => Date,
  idFactory: () => string,
  reason: string,
): WorkUnit {
  const timestamp = now().toISOString()
  return {
    id: `WU-${idFactory()}`,
    spaceId,
    title: rawRequest.slice(0, 72),
    outcome: rawRequest,
    state: 'blocked',
    owner: 'development-aaop',
    gate: { kind: 'none', open: false },
    acceptance: [],
    evidence: [],
    assets: [],
    nextFrontier: reason,
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}
