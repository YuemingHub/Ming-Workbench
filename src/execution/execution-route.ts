/**
 * ExecutionRoute — the smallest honest claim about how a confirmed round
 * agreement can become a real outcome.
 *
 * V1 supports exactly two routes:
 *
 *   - `software_development`: the agreement explicitly names a software surface
 *     (web page, website, application, UI, …) that Ming Workbench can produce
 *     through the existing AAOP -> Harness -> isolated mutation -> verification
 *     chain.
 *   - `unsupported`: anything else. We never invent a user goal or fabricate a
 *     software interpretation; the outcome projection stays honest.
 *
 * The classifier is deterministic and grounded only in what the human actually
 * agreed to: a conservative keyword check over the four round-agreement
 * semantics (willGet / solves / whereSee / notDoing) plus the synthesis
 * recommendation. No external model, no free-text interpretation.
 */

import type { HumanFirstIdea } from '../idea/idea-space.js'

export type ExecutionRoute = 'software_development' | 'unsupported'

export interface RouteDecision {
  route: ExecutionRoute
  /** Human-readable reason grounded in the agreement text. */
  reason: string
  /** The exact agreement/synthesis surfaces that triggered the route. */
  matchedOn: string[]
}

/** Conservative software surfaces. Kept narrow on purpose: generic words such
 * as "工具" or "东西" must never route to software execution on their own. */
const SOFTWARE_SURFACE_KEYWORDS = [
  '网页',
  '网站',
  '页面',
  '应用',
  '软件',
  '程序',
  '小程序',
  'web',
  'Web',
  '界面',
  'app',
  'App',
] as const

export function assertConfirmedWithAgreement(idea: HumanFirstIdea): void {
  if (idea.stage !== 'confirmed') {
    throw new Error(
      `Cannot route an idea that is not confirmed (current stage: ${idea.stage}).`,
    )
  }
  if (!idea.agreement) {
    throw new Error('Cannot route a confirmed idea that has no round agreement.')
  }
  if (!idea.synthesis) {
    throw new Error('Cannot route a confirmed idea that has no synthesis.')
  }
}

/**
 * Deterministically classify a confirmed idea into an ExecutionRoute using the
 * round agreement text only.
 */
export function routeForConfirmedIdea(idea: HumanFirstIdea): RouteDecision {
  assertConfirmedWithAgreement(idea)
  const agreement = idea.agreement!
  const synthesis = idea.synthesis!

  const surfaces = [
    agreement.willGet,
    agreement.solves,
    agreement.whereSee,
    agreement.notDoing,
    synthesis.recommendation,
    synthesis.desiredReality,
  ]
  const text = surfaces.join('\n')
  const matched = SOFTWARE_SURFACE_KEYWORDS.filter((keyword) => text.includes(keyword))

  if (matched.length > 0) {
    return {
      route: 'software_development',
      reason: `Round agreement explicitly names a software surface (${matched.join(' / ')}) that Ming Workbench can produce and verify.`,
      matchedOn: matched,
    }
  }

  return {
    route: 'unsupported',
    reason:
      'Round agreement does not name a software surface Ming Workbench can produce with existing execution capability.',
    matchedOn: [],
  }
}
