import type { WorkUnit } from '../core/model.js'
import {
  assessRepositoryFrontier,
  type FrontierDecision,
  type RepositoryFrontier,
} from './repository-frontier.js'

export interface DomainPackDescriptor {
  id: string
  title: string
  controlProtocol: string
  preferredHost: string
  durableExecutionPolicy: string
}

export const developmentAaopPack: DomainPackDescriptor = {
  id: 'development-aaop',
  title: 'Software Development · AAOP',
  controlProtocol: 'AAOP',
  preferredHost: 'deepseek-harness',
  durableExecutionPolicy: 'loopx-only-after-proven-execution-continuity-gap',
}

/**
 * Workbench-owned input handed TO AAOP Developer Intake.
 *
 * This is intentionally NOT AAOP's canonical `intake-envelope.schema.json`.
 * AAOP must inspect project evidence and determine situation, Route,
 * confidence, ambiguities, and whether a human question is actually needed.
 */
export interface AaopDeveloperRequest {
  rawRequest: string
  desiredOutcome: string
  currentWorkbenchState: WorkUnit['state']
  workUnitId: string
  acceptanceExpectations: string[]
  authorizationBoundary: string
}

export interface RepositoryAdmissionTarget {
  frontier: RepositoryFrontier
  intendedFiles: string[]
}

export interface DevelopmentAdmissionRequest {
  unit: WorkUnit
  rawRequest?: string
  authorizationBoundary: string
  repository?: RepositoryAdmissionTarget
}

export type DevelopmentAdmissionResult =
  | {
      status: 'admitted'
      aaopRequest: AaopDeveloperRequest
      frontierDecision?: FrontierDecision
      reason: string
    }
  | {
      status: 'deferred'
      frontierDecision: FrontierDecision
      reason: string
    }

/**
 * Build only the Workbench-owned request AAOP needs to begin Developer Intake.
 * Do not add situation, Route, route confidence, question-needed, Task Pod, or
 * provider decisions here; those are AAOP-owned outputs of grounded intake.
 */
export function toAaopDeveloperRequest(
  unit: WorkUnit,
  authorizationBoundary: string,
  rawRequest = unit.outcome,
): AaopDeveloperRequest {
  return {
    rawRequest,
    desiredOutcome: unit.outcome,
    currentWorkbenchState: unit.state,
    workUnitId: unit.id,
    acceptanceExpectations: unit.acceptance.map((criterion) => criterion.statement),
    authorizationBoundary,
  }
}

/**
 * Admit a development Work Unit to AAOP only after any known repository target
 * has a proven non-conflicting file surface. A deferred result is not a human
 * gate by itself: the orchestrator may narrow, reroute, wait for handoff, or
 * inspect fresher repository evidence before involving the user.
 */
export function admitDevelopmentWorkUnit(
  request: DevelopmentAdmissionRequest,
): DevelopmentAdmissionResult {
  const buildAaopRequest = () =>
    toAaopDeveloperRequest(
      request.unit,
      request.authorizationBoundary,
      request.rawRequest,
    )

  if (!request.repository) {
    return {
      status: 'admitted',
      aaopRequest: buildAaopRequest(),
      reason:
        'No existing-repository target was supplied; repository-frontier admission is not applicable to this request.',
    }
  }

  const frontierDecision = assessRepositoryFrontier(
    request.repository.frontier,
    request.repository.intendedFiles,
  )

  if (!frontierDecision.safeToStart) {
    return {
      status: 'deferred',
      frontierDecision,
      reason: frontierDecision.reason,
    }
  }

  return {
    status: 'admitted',
    aaopRequest: buildAaopRequest(),
    frontierDecision,
    reason:
      'Repository-frontier admission passed; AAOP Developer Intake may now determine Situation, Route, decision ownership, provider selection and acceptance.',
  }
}
