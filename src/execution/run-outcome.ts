/**
 * P0-2: the four status axes of a bounded execution run.
 *
 * These axes are deliberately separate. A Harness session completing proves at
 * most `RunStatus completed` — it can never prove a Work Unit accepted.
 *
 *   RunStatus           what happened to the run itself
 *   EffectObservation   what REAL repository/runtime evidence shows
 *   VerificationVerdict the independent verification verdict
 *   AcceptanceVerdict   product-level acceptance (human-owned)
 *
 * The classifier below derives the four axes from real evidence only. It never
 * reads Harness chatter, session completion, or assistant narratives.
 */

export type RunStatus =
  | 'started'
  | 'running'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'orphaned'

export type EffectObservation =
  | 'mutation-observed'
  | 'no-mutation'
  | 'external-observed'
  | 'external-unknown'
  | 'unknown'

export type VerificationVerdict = 'pending' | 'passed' | 'failed' | 'inconclusive'

export type AcceptanceVerdict = 'pending' | 'accepted' | 'rejected'

export interface RunOutcome {
  runStatus: RunStatus
  effect: EffectObservation
  verification: VerificationVerdict
  acceptance: AcceptanceVerdict
  reason: string
}

export interface RunOutcomeInputs {
  /** Files newly dirtied by THIS execution (pre-existing dirty already excluded). */
  producedChanges: string[]
  /** Files changed by this execution outside the authorized scope. */
  scopeViolations: string[]
  /**
   * Real test outcome AFTER execution. `null` means the project has no test
   * command (N/A): verification is then based on the mutation itself, not a
   * test gate. `undefined` means tests were not run at all.
   */
  testsPassedAfter?: boolean | null
  /** Real test outcome BEFORE execution (needed to detect pre-green no-ops). */
  testsPassedBefore?: boolean | null
  /** Whether the grant authorizes non-local effects (deploy/publish/…). */
  hasExternalEffects: boolean
}

/**
 * Derive the four status axes from real repository/test evidence.
 *
 * P0-2 regressions enforced here:
 *
 *   A. Tests green BEFORE + agent no-op + tests still green AFTER is NOT task
 *      success — nothing new was produced to verify, so verification is
 *      inconclusive and the product must ask the human what to do next.
 *   B. A mutation that leaves tests failing is mutation-observed but
 *      verification failed / acceptance rejected — never verification success.
 *   C. A completed run never yields acceptance: accepted is human-owned and
 *      unreachable from this classifier.
 */
export function deriveRunOutcome(inputs: RunOutcomeInputs): RunOutcome {
  const produced = inputs.producedChanges.length > 0
  const testsAfter = inputs.testsPassedAfter === true
  const testsBefore = inputs.testsPassedBefore === true
  const noTestCommand = inputs.testsPassedAfter === null

  // Hard boundary failure: the run mutated outside the authorized slice.
  if (inputs.scopeViolations.length > 0) {
    return {
      runStatus: 'completed',
      effect: produced ? 'mutation-observed' : 'no-mutation',
      verification: 'failed',
      acceptance: 'rejected',
      reason: `Execution changed files outside the granted scope: ${inputs.scopeViolations.join(', ')}.`,
    }
  }

  // External effects cannot be verified from local state; a reconciler must
  // confirm them before anything can advance.
  if (inputs.hasExternalEffects) {
    return {
      runStatus: 'completed',
      effect: 'external-unknown',
      verification: 'pending',
      acceptance: 'pending',
      reason:
        'Harness completed but the external effect outcome is unknown and must be reconciled.',
    }
  }

  // Regression A: pre-green no-op run. Not success — nothing to verify.
  if (!produced && testsAfter && testsBefore) {
    return {
      runStatus: 'completed',
      effect: 'no-mutation',
      verification: 'inconclusive',
      acceptance: 'pending',
      reason:
        'No change was produced by this execution and project tests were already green before it started; there is nothing new to verify.',
    }
  }

  if (!produced && !testsAfter && !noTestCommand) {
    return {
      runStatus: 'completed',
      effect: 'no-mutation',
      verification: 'failed',
      acceptance: 'pending',
      reason: 'No repository changes were produced by this execution and tests did not pass.',
    }
  }

  if (!produced && noTestCommand) {
    return {
      runStatus: 'completed',
      effect: 'no-mutation',
      verification: 'failed',
      acceptance: 'pending',
      reason: 'No repository changes were produced by this execution; there is nothing new to verify.',
    }
  }

  // Regression B: mutation with failing tests is verification failure.
  if (produced && !testsAfter && !noTestCommand) {
    return {
      runStatus: 'completed',
      effect: 'mutation-observed',
      verification: 'failed',
      acceptance: 'rejected',
      reason: 'Changes were produced by this execution but project tests failed.',
    }
  }

  // Mutation observed. When the project has no test command (N/A), the
  // repository readback itself is the verification; otherwise real tests must
  // pass after execution. Acceptance stays pending (human-owned).
  return {
    runStatus: 'completed',
    effect: 'mutation-observed',
    verification: noTestCommand ? 'passed' : 'passed',
    acceptance: 'pending',
    reason: noTestCommand
      ? `Local repository changes produced by this execution: ${inputs.producedChanges.join(', ')} (no project test command; repository readback is the verification).`
      : `Local repository changes produced by this execution: ${inputs.producedChanges.join(', ')}; project tests passed after execution.`,
  }
}
