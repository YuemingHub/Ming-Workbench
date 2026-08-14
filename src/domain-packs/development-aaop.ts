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

export interface AaopIntakeEnvelope {
  userOutcome: string
  currentState: WorkUnit['state']
  workUnitId: string
  acceptance: string[]
  authorizationBoundary: string
}

export interface RepositoryAdmissionTarget {
  frontier: RepositoryFrontier
  intendedFiles: string[]
}

export interface DevelopmentAdmissionRequest {
  unit: WorkUnit
  authorizationBoundary: string
  repository?: RepositoryAdmissionTarget
}

export type DevelopmentAdmissionResult =
  | {
      status: 'admitted'
      aaopIntake: AaopIntakeEnvelope
      frontierDecision?: FrontierDecision
      reason: string
    }
  | {
      status: 'deferred'
      frontierDecision: FrontierDecision
      reason: string
    }

/**
 * This is deliberately a narrow seam. AAOP remains authoritative for Route,
 * Working Contract, authorization, Task Pod responsibility and acceptance.
 * Workbench does not recreate those state machines.
 */
export function toAaopIntake(
  unit: WorkUnit,
  authorizationBoundary: string,
): AaopIntakeEnvelope {
  return {
    userOutcome: unit.outcome,
    currentState: unit.state,
    workUnitId: unit.id,
    acceptance: unit.acceptance.map((criterion) => criterion.statement),
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
  if (!request.repository) {
    return {
      status: 'admitted',
      aaopIntake: toAaopIntake(request.unit, request.authorizationBoundary),
      reason:
        'No existing-repository target was supplied; repository-frontier admission is not applicable to this intake.',
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
    aaopIntake: toAaopIntake(request.unit, request.authorizationBoundary),
    frontierDecision,
    reason:
      'Repository-frontier admission passed; AAOP may now evaluate Route, authorization, provider selection and acceptance.',
  }
}
