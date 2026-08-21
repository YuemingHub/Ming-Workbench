/**
 * Confirmed-agreement -> Execution bridge.
 *
 * This is the missing layer between the human-first V1 entry (confirmed round
 * agreement) and the existing AAOP -> Harness -> verification execution chain.
 * It is intentionally thin: it compiles the executable goal, decides the route,
 * and for `software_development` creates the Work Unit through the existing
 * `createIntakeWorkUnit` factory. It never re-implements the execution chain.
 *
 * When the route is `unsupported`, the bridge answers honestly instead of
 * fabricating a software Work Unit: the human keeps their confirmed idea and
 * gets a clear "not supported yet" projection.
 */

import type { WorkUnit } from '../core/model.js'
import { compileExecutableGoal, type ExecutableGoal } from '../execution/executable-goal.js'
import { routeForConfirmedIdea, type RouteDecision } from '../execution/execution-route.js'
import { createIntakeWorkUnit } from '../intake/project-aaop.js'
import type { HumanFirstIdea } from '../idea/idea-space.js'

export interface BridgeConfirmedIdeaOptions {
  /** Space the Work Unit belongs to (the future workspace id). */
  spaceId: string
  now?: () => Date
  idFactory?: () => string
}

export type BridgeConfirmedIdeaResult =
  | {
      status: 'software-execution'
      route: RouteDecision
      goal: ExecutableGoal
      workUnit: WorkUnit
    }
  | {
      status: 'unsupported'
      route: RouteDecision
      goal: ExecutableGoal
      reason: string
    }

export function bridgeConfirmedIdeaToExecution(
  idea: HumanFirstIdea,
  options: BridgeConfirmedIdeaOptions,
): BridgeConfirmedIdeaResult {
  const goal = compileExecutableGoal(idea)
  const route = routeForConfirmedIdea(idea)

  if (route.route === 'unsupported') {
    return {
      status: 'unsupported',
      route,
      goal,
      reason: route.reason,
    }
  }

  const workUnit = createIntakeWorkUnit(
    goal.goalStatement,
    options.spaceId,
    options.now,
    options.idFactory,
  )
  // Preserve the human-agreed criteria on the real Work Unit. The criteria are
  // still unsatisfied and carry no evidence until a later verification/acceptance
  // step; omitting them would make the completion invariant unreachable.
  workUnit.acceptance = goal.acceptanceCriteria.map((statement, index) => ({
    id: `AC-${workUnit.id}-${index + 1}`,
    statement,
    satisfied: false,
    evidenceIds: [],
  }))

  return {
    status: 'software-execution',
    route,
    goal,
    workUnit,
  }
}
