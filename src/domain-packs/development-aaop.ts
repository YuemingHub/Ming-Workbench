import type { WorkUnit } from '../core/model.js'

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
