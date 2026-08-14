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

/**
 * Repository evidence available while AAOP is still understanding the task.
 * `intendedFiles` may be absent because discovering the correct mutation scope
 * is often part of Developer Intake itself.
 */
export interface RepositoryIntakeContext {
  frontier: RepositoryFrontier
  intendedFiles?: string[]
}

export interface DevelopmentIntakePreparationRequest {
  unit: WorkUnit
  rawRequest?: string
  authorizationBoundary: string
  repository?: RepositoryIntakeContext
}

export interface DevelopmentIntakePreparationResult {
  status: 'ready-for-aaop-intake'
  aaopRequest: AaopDeveloperRequest
  /**
   * Advisory intake-time evidence only. It never authorizes execution because
   * active repository work may change while AAOP is reasoning.
   */
  frontierContext?: FrontierDecision
  /** Existing-repository mutation must always re-read frontier before execution. */
  executionRequiresFreshFrontier: boolean
  reason: string
}

export interface DevelopmentExecutionFrontierRequest {
  frontier: RepositoryFrontier
  intendedFiles: string[]
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
 * Prepare a Work Unit for grounded AAOP Developer Intake.
 *
 * Repository conflict evidence may constrain or redirect the eventual plan, but
 * it must not prevent the read-only reasoning needed to discover the correct
 * file scope. This preserves the ordinary-language user experience: the human
 * states the goal; AAOP inspects the project before asking them to name files.
 */
export function prepareDevelopmentIntake(
  request: DevelopmentIntakePreparationRequest,
): DevelopmentIntakePreparationResult {
  const aaopRequest = toAaopDeveloperRequest(
    request.unit,
    request.authorizationBoundary,
    request.rawRequest,
  )

  if (!request.repository) {
    return {
      status: 'ready-for-aaop-intake',
      aaopRequest,
      executionRequiresFreshFrontier: false,
      reason:
        'No existing-repository context was supplied; AAOP Developer Intake may inspect the situation before any execution target exists.',
    }
  }

  const frontierContext = assessRepositoryFrontier(
    request.repository.frontier,
    request.repository.intendedFiles ?? [],
  )

  return {
    status: 'ready-for-aaop-intake',
    aaopRequest,
    frontierContext,
    executionRequiresFreshFrontier: true,
    reason: frontierContext.safeToStart
      ? 'Current repository evidence shows no known overlap, but AAOP may only treat this as intake context; execution still requires a fresh frontier read.'
      : 'Current repository evidence is unresolved or conflicting. AAOP may continue read-only Developer Intake to narrow/reroute the plan, but execution remains blocked until a fresh frontier check passes.',
  }
}

/**
 * Hard pre-execution gate for an existing repository mutation.
 *
 * Call this with fresh active-work evidence AFTER AAOP has determined the exact
 * intended file surface and BEFORE issuing/consuming a write execution grant.
 */
export function assessDevelopmentExecutionFrontier(
  request: DevelopmentExecutionFrontierRequest,
): FrontierDecision {
  return assessRepositoryFrontier(request.frontier, request.intendedFiles)
}
