/**
 * ExecutionRun — the correlation record that binds one closed loop.
 *
 * The loop is implemented as discrete, well-tested functions (intake
 * application, grant issuance, bounded execution). What is missing is a single
 * traceable record that ties the confirmed Human Intent that originated the work
 * to the Work Unit it became, the AAOP Intake Envelope that grounded it, the
 * Provider Execution Grant that authorized it, and the real execution result +
 * evidence it produced.
 *
 * ExecutionRun is exactly that correlation. It is a pure value object: it does
 * not schedule, retry, branch, or persist anything. It holds no state of its
 * own and owns no lifecycle — the Work Unit remains the single source of truth
 * and the bounded-execution result remains the authority on reality. This is
 * not a workflow engine and not a memory store; it is the projection of one
 * real run's already-existing artifacts under one traceable id.
 */

import { randomUUID } from 'node:crypto'
import type { AaopIntakeEnvelope } from '../intake/aaop-envelope.js'
import type { AaopCoordinatorResult } from '../intake/coordinator.js'
import type { ProviderExecutionGrant } from './provider-grant.js'
import type { BoundedExecutionResult } from './bounded-execution.js'

export interface ExecutionRun {
  /** Stable run id for this one closed loop. */
  id: string
  /** The confirmed HumanFirstIdea id that originated the work (Human Intent). */
  ideaId: string
  /** The Work Unit the idea became through intake. */
  workUnitId: string
  /** AAOP's canonical Intake Envelope (Situation/Route/next_action). */
  intakeEnvelope: AaopIntakeEnvelope
  /** The Provider Execution Grant id that authorized the bounded mutation. */
  grantId: string
  /** The Harness session id from execution. */
  sessionId: string
  /** The real bounded-execution result: runOutcome + repositoryReadback + evidence-backed Work Unit. */
  execution: BoundedExecutionResult
  startedAt: string
  completedAt: string
}

export interface BuildExecutionRunOptions {
  ideaId: string
  intake: AaopCoordinatorResult
  grant: ProviderExecutionGrant
  execution: BoundedExecutionResult
  now?: () => Date
  idFactory?: () => string
}

/**
 * Correlate the four real artifacts of one closed loop into a single traceable
 * ExecutionRun. Every field is sourced from a real upstream result; nothing is
 * fabricated here. The run id links idea → Work Unit → grant → execution so the
 * human who confirmed the intent can trace the evidence back to its origin.
 */
export function buildExecutionRun(options: BuildExecutionRunOptions): ExecutionRun {
  const now = options.now ?? (() => new Date())
  return {
    id: `RUN-${options.idFactory?.() ?? randomUUID()}`,
    ideaId: options.ideaId,
    workUnitId: options.intake.workUnit.id,
    intakeEnvelope: options.intake.envelope,
    grantId: options.grant.grant_id,
    sessionId: options.execution.sessionId,
    execution: options.execution,
    startedAt: options.intake.workUnit.createdAt,
    completedAt: now().toISOString(),
  }
}
