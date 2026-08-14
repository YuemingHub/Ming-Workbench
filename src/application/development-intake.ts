import { resolve } from 'node:path'
import type { Evidence, Gate, Space, WorkUnit, WorkUnitState } from '../core/model.js'
import type { AaopIntakeEnvelope } from '../intake/aaop-envelope.js'
import {
  prepareProjectDevelopmentIntake,
  type PrepareProjectIntakeOptions,
  type PreparedProjectIntake,
} from '../intake/project-aaop.js'
import {
  runProjectAaopCoordinator,
  type AaopCoordinatorResult,
  type RunAaopCoordinatorOptions,
} from '../intake/coordinator.js'

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
  prepareProjectIntake?: (
    options: PrepareProjectIntakeOptions,
  ) => PreparedProjectIntake
  runCoordinator?: (
    options: RunAaopCoordinatorOptions,
  ) => Promise<AaopCoordinatorResult>
}

export interface WorkUnitDisplayEvidence {
  id: string
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

export interface DevelopmentIntakeProjectView {
  id: string
  title: string
  root: string
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
      status: 'blocked'
      project: DevelopmentIntakeProjectView
      workUnit: WorkUnitDisplayView
      blocker: string
    }
  | {
      status: 'ready' | 'needs-human'
      project: DevelopmentIntakeProjectView
      workUnit: WorkUnitDisplayView
      intake: DevelopmentIntakeEnvelopeView
    }

function createSpace(
  projectId: string,
  projectTitle: string,
  now: Date,
): Space {
  return {
    id: `SPACE-${projectId}`,
    title: projectTitle,
    domainPackId: 'development-aaop',
    createdAt: now.toISOString(),
  }
}

function projectView(
  projectRoot: string,
  projectId: string,
  projectTitle: string,
): DevelopmentIntakeProjectView {
  return {
    id: projectId,
    title: projectTitle,
    root: resolve(projectRoot),
    domainPackId: 'development-aaop',
  }
}

/**
 * Build the normal human-facing Work Unit projection used by the future local
 * Web/Desktop shell. Raw ACP payloads, Harness plugin details, and session IDs
 * stay below this boundary. Advanced diagnostics can be added through a
 * separate explicit inspector surface later.
 */
export function toWorkUnitDisplayView(unit: WorkUnit): WorkUnitDisplayView {
  return {
    id: unit.id,
    title: unit.title,
    outcome: unit.outcome,
    state: unit.state,
    gate: { ...unit.gate },
    evidence: unit.evidence.map((evidence) => ({
      id: evidence.id,
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
 * First desktop-product application slice:
 *
 * project + ordinary-language request
 * -> trusted project AAOP bridge
 * -> hard read-only Developer Intake
 * -> Workbench-owned Work Unit / Gate / Evidence view
 *
 * This surface deliberately does not issue a Provider Execution Grant or start
 * write execution. It is safe to use as the first product milestone before a
 * native shell or mutation UI exists.
 */
export async function runDevelopmentIntakeApplication(
  options: DevelopmentIntakeApplicationOptions,
  dependencies: DevelopmentIntakeApplicationDependencies = {},
): Promise<DevelopmentIntakeApplicationResult> {
  const prepare = dependencies.prepareProjectIntake ?? prepareProjectDevelopmentIntake
  const coordinate = dependencies.runCoordinator ?? runProjectAaopCoordinator
  const now = options.now ?? (() => new Date())
  const prepared = prepare({
    rawRequest: options.rawRequest,
    projectRoot: options.projectRoot,
    spaceId: 'SPACE-pending-project-manifest',
    trustedProject: options.trustedProject,
    authorizationBoundary: options.authorizationBoundary,
    now,
    idFactory: options.idFactory,
  })

  const space = createSpace(
    prepared.manifest.project.id,
    prepared.manifest.project.title,
    now(),
  )
  prepared.workUnit.spaceId = space.id
  const project = projectView(
    options.projectRoot,
    prepared.manifest.project.id,
    prepared.manifest.project.title,
  )

  if (prepared.status === 'project-aaop-blocked') {
    return {
      status: 'blocked',
      project,
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
    project,
    workUnit: toWorkUnitDisplayView(coordinated.workUnit),
    intake: toDevelopmentIntakeEnvelopeView(coordinated.envelope),
  }
}
