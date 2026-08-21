/**
 * compileExecutableGoal — turn a confirmed round agreement into the smallest
 * executable statement + acceptance criteria + scope boundary that a Work Unit
 * can carry.
 *
 * This is Intent Truth made executable. It adds nothing the human did not
 * agree to: the goal statement, acceptance criteria, and scope boundary quote
 * the round-agreement semantics directly (willGet / solves / whereSee /
 * notDoing) and the synthesis recommendation.
 */

import type { HumanFirstIdea } from '../idea/idea-space.js'
import {
  assertConfirmedWithAgreement,
  routeForConfirmedIdea,
  type ExecutionRoute,
} from './execution-route.js'

export interface ExecutableGoal {
  /** The single outcome sentence the Work Unit will pursue (never empty). */
  goalStatement: string
  /** Acceptance criteria derived from the round agreement. */
  acceptanceCriteria: string[]
  /** Explicit scope boundary — what this round agreed NOT to do. */
  scopeBoundary: string[]
  /** How the outcome is meant to be seen / used. */
  usageSurface: string
  route: ExecutionRoute
  routeReason: string
  sourceIdeaId: string
}

function firstNonEmpty(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => typeof value === 'string' && value.trim().length > 0)
}

export function compileExecutableGoal(idea: HumanFirstIdea): ExecutableGoal {
  assertConfirmedWithAgreement(idea)
  const agreement = idea.agreement!
  const synthesis = idea.synthesis!
  const route = routeForConfirmedIdea(idea)

  const goalStatement = firstNonEmpty(
    agreement.willGet,
    synthesis.recommendation,
    agreement.solves,
  )
  if (!goalStatement) {
    throw new Error(
      'Cannot compile an executable goal from a confirmed idea with no willGet/recommendation/solves statement.',
    )
  }

  const scopeBoundary = agreement.notDoing.trim()
    ? [agreement.notDoing.trim()]
    : []

  return {
    goalStatement: goalStatement.trim(),
    acceptanceCriteria: [
      `得到：${agreement.willGet.trim()}`,
      `解决：${agreement.solves.trim()}`,
      `使用方式：${agreement.whereSee.trim()}`,
      ...scopeBoundary.map((boundary) => `范围：${boundary}`),
    ],
    scopeBoundary,
    usageSurface: agreement.whereSee.trim(),
    route: route.route,
    routeReason: route.reason,
    sourceIdeaId: idea.id,
  }
}
