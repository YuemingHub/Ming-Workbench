import type { Evidence, Gate, WorkUnit, WorkUnitState } from '../core/model.js'
import type { AaopIntakeEnvelope } from '../intake/aaop-envelope.js'
import {
  createIntakeWorkUnit,
  prepareProjectDevelopmentIntake,
  type PrepareProjectIntakeOptions,
  type PreparedProjectIntake,
} from '../intake/project-aaop.js'
import {
  runProjectAaopCoordinator,
  type AaopCoordinatorResult,
  type RunAaopCoordinatorOptions,
} from '../intake/coordinator.js'
import {
  resolveProjectOnboarding,
  type ProjectOnboardingIdentity,
  type ProjectOnboardingResult,
} from '../projects/onboarding.js'

export interface DevelopmentIntakeApplicationOptions {
  rawRequest: string
  projectRoot: string
  trustedProject: boolean
  harnessCheckout: string
  workbenchRoot: string
  provider?: string
  model?: string
  sessionRoot?: string
  authorizationBoundary?: string
  now?: () => Date
  idFactory?: () => string
}

export interface DevelopmentIntakeApplicationDependencies {
  resolveOnboarding?: (projectRoot: string) => ProjectOnboardingResult
  prepareProjectIntake?: (
    options: PrepareProjectIntakeOptions,
  ) => PreparedProjectIntake
  runCoordinator?: (
    options: RunAaopCoordinatorOptions,
  ) => Promise<AaopCoordinatorResult>
}

export interface WorkUnitDisplayEvidence {
  kind: Evidence['kind']
  summary: string
  observedAt: string
  authoritative: boolean
}

export interface WorkUnitDisplayView {
  id: string
  title: string
  outcome: string
  state: WorkUnitState
  gate: Gate
  evidence: WorkUnitDisplayEvidence[]
  nextFrontier?: string
}

export interface DevelopmentSpaceView {
  id: string
  title: string
  projectId: string
  projectRoot: string
  domainPackId: 'development-aaop'
}

export interface DevelopmentIntakeEnvelopeView {
  situation: AaopIntakeEnvelope['situation']
  route: AaopIntakeEnvelope['route']
  routeConfidence: number
  ambiguities: string[]
  questionNeeded: string | null
  projectEvidenceSummary: string[]
  nextAction: string
}

export type DevelopmentIntakeApplicationResult =
  | {
      status: 'setup-required'
      space: DevelopmentSpaceView
      workUnit: WorkUnitDisplayView
      setup: {
        kind: 'aaop'
        summary: string
      }
    }
  | {
      status: 'blocked'
      space: DevelopmentSpaceView
      workUnit: WorkUnitDisplayView
      blocker: string
    }
  | {
      status: 'ready' | 'needs-human'
      space: DevelopmentSpaceView
      workUnit: WorkUnitDisplayView
      intake: DevelopmentIntakeEnvelopeView
    }

function createDevelopmentSpaceView(
  project: ProjectOnboardingIdentity,
): DevelopmentSpaceView {
  return {
    id: `SPACE-${project.id}`,
    title: project.title,
    projectId: project.id,
    projectRoot: project.root,
    domainPackId: 'development-aaop',
  }
}

function createOnboardingWorkUnit(
  options: DevelopmentIntakeApplicationOptions,
  space: DevelopmentSpaceView,
  state: 'needs-human' | 'blocked',
  summary: string,
): WorkUnit {
  const now = options.now ?? (() => new Date())
  const unit = createIntakeWorkUnit(
    options.rawRequest,
    space.id,
    now,
    options.idFactory,
  )
  unit.state = state
  unit.gate = state === 'needs-human'
    ? {
        kind: 'authorization',
        open: true,
        owner: 'human',
        summary,
      }
    : { kind: 'none', open: false }
  unit.nextFrontier = summary
  unit.updatedAt = now().toISOString()
  return unit
}

/**
 * Build the normal human-facing Work Unit projection used by the future local
 * Web/Desktop shell. Raw ACP payloads, provider-specific URIs, Harness plugin
 * details, and session identities stay below this boundary. Advanced
 * diagnostics can be added through a separate explicit inspector surface later.
 */
export function toWorkUnitDisplayView(unit: WorkUnit): WorkUnitDisplayView {
  return {
    id: unit.id,
    title: unit.title,
    outcome: unit.outcome,
    state: unit.state,
    gate: { ...unit.gate },
    evidence: unit.evidence.map((evidence) => ({
      kind: evidence.kind,
      summary: evidence.summary,
      observedAt: evidence.observedAt,
      authoritative: evidence.authoritative,
    })),
    nextFrontier: unit.nextFrontier,
  }
}

export function toDevelopmentIntakeEnvelopeView(
  envelope: AaopIntakeEnvelope,
): DevelopmentIntakeEnvelopeView {
  return {
    situation: envelope.situation,
    route: envelope.route,
    routeConfidence: envelope.route_confidence,
    ambiguities: [...envelope.ambiguities],
    questionNeeded: envelope.question_needed,
    projectEvidenceSummary: [...envelope.project_evidence_summary],
    nextAction: envelope.next_action,
  }
}

/**
 * Desktop-product application slice:
 *
 * project + ordinary-language request
 * -> read-only Workbench onboarding discovery
 * -> explicit manifest OR derived installed-AAOP bridge OR setup Gate
 * -> trusted project AAOP bridge
 * -> hard read-only Developer Intake
 * -> Workbench-owned Space / Work Unit / Gate / Evidence view
 *
 * This surface deliberately does not install AAOP, issue a Provider Execution
 * Grant, or start write execution. Project setup remains a separate authorized
 * lifecycle action owned by AAOP's canonical bootstrap/installer.
 */
export async function runDevelopmentIntakeApplication(
  options: DevelopmentIntakeApplicationOptions,
  dependencies: DevelopmentIntakeApplicationDependencies = {},
): Promise<DevelopmentIntakeApplicationResult> {
  const onboard = dependencies.resolveOnboarding ?? resolveProjectOnboarding
  const prepare = dependencies.prepareProjectIntake ?? prepareProjectDevelopmentIntake
  const coordinate = dependencies.runCoordinator ?? runProjectAaopCoordinator
  const now = options.now ?? (() => new Date())

  const onboarding = onboard(options.projectRoot)
  const space = createDevelopmentSpaceView(onboarding.project)

  if (onboarding.status === 'setup-required') {
    const summary = 'Enable AAOP for this project to continue grounded development intake.'
    const unit = createOnboardingWorkUnit(options, space, 'needs-human', summary)
    return {
      status: 'setup-required',
      space,
      workUnit: toWorkUnitDisplayView(unit),
      setup: {
        kind: 'aaop',
        summary,
      },
    }
  }

  if (onboarding.status === 'blocked') {
    const unit = createOnboardingWorkUnit(
      options,
      space,
      'blocked',
      onboarding.reason,
    )
    return {
      status: 'blocked',
      space,
      workUnit: toWorkUnitDisplayView(unit),
      blocker: onboarding.reason,
    }
  }

  const prepared = prepare({
    rawRequest: options.rawRequest,
    projectRoot: options.projectRoot,
    spaceId: space.id,
    trustedProject: options.trustedProject,
    authorizationBoundary: options.authorizationBoundary,
    manifest: onboarding.manifest,
    now,
    idFactory: options.idFactory,
  })

  if (prepared.status === 'project-aaop-blocked') {
    return {
      status: 'blocked',
      space,
      workUnit: toWorkUnitDisplayView(prepared.workUnit),
      blocker: prepared.reason,
    }
  }

  const coordinated = await coordinate({
    prepared,
    projectRoot: options.projectRoot,
    harnessCheckout: options.harnessCheckout,
    workbenchRoot: options.workbenchRoot,
    provider: options.provider,
    model: options.model,
    sessionRoot: options.sessionRoot,
    now,
  })

  return {
    status: coordinated.workUnit.gate.open ? 'needs-human' : 'ready',
    space,
    workUnit: toWorkUnitDisplayView(coordinated.workUnit),
    intake: toDevelopmentIntakeEnvelopeView(coordinated.envelope),
  }
}
