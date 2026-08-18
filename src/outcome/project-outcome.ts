/**
 * Outcome Projection — turn real execution evidence into the future shape of
 * the outcome in human language.
 *
 * Workbench owns this projection. It is a deterministic mapping over the four
 * run-outcome axes (RunStatus / EffectObservation / VerificationVerdict /
 * AcceptanceVerdict); the status comes from facts. This stage uses
 * deterministic human-language templates; a model may later translate the same
 * facts into richer phrasing, but it can never override the fact-derived
 * status.
 *
 *   completed  — outcome produced, verified, and accepted by the human
 *   partial    — outcome produced and verified, awaiting human acceptance
 *   failed     — execution produced nothing usable or verification failed
 *   not_proven — no independent evidence that the outcome is true
 */

import type { RunOutcome } from '../execution/run-outcome.js'

export type ProjectOutcomeStatus = 'completed' | 'partial' | 'failed' | 'not_proven'

export interface ProjectOutcome {
  status: ProjectOutcomeStatus
  summary: string
  detail: string
}

export function projectOutcomeFromRun(outcome: RunOutcome): ProjectOutcome {
  // Hard failure: verification failed (includes scope violations and produced
  // changes that left tests failing).
  if (outcome.verification === 'failed') {
    return {
      status: 'failed',
      summary: '这次执行没有产出可用的成果。',
      detail: outcome.reason,
    }
  }

  // Nothing was produced: there is no outcome to prove.
  if (outcome.effect === 'no-mutation') {
    return {
      status: 'not_proven',
      summary: '这次执行没有产生任何变化，成果还没有被证明。',
      detail: outcome.reason,
    }
  }

  // Verification is still pending or inconclusive (includes external effects).
  if (outcome.verification !== 'passed') {
    return {
      status: 'not_proven',
      summary: '执行完成，但还缺少独立验证，成果还没有被证明。',
      detail: outcome.reason,
    }
  }

  // Mutation observed + verification passed. Acceptance is human-owned.
  if (outcome.effect === 'mutation-observed') {
    if (outcome.acceptance === 'accepted') {
      return {
        status: 'completed',
        summary: '成果已经产生并通过验证，你已经验收。',
        detail: outcome.reason,
      }
    }
    return {
      status: 'partial',
      summary: '成果已经产生并通过验证，还差你亲自验收。',
      detail: outcome.reason,
    }
  }

  // Any other observation shape (external observed, unknown) is not proven yet.
  return {
    status: 'not_proven',
    summary: '这个成果的效果发生在当前仓库之外，需要真实核对后才能下结论。',
    detail: outcome.reason,
  }
}
