/**
 * Evidence Projection — the human-facing return view of one closed loop.
 *
 * After bounded execution, the Work Unit carries evidence inline and the
 * bounded-execution result carries the repository readback. Neither is shaped
 * for the person who confirmed the original intent: the Work Unit is the
 * product-internal record, the readback is execution-internal. This module
 * projects the two into one Evidence Return that says, in honest terms, what
 * reality changed and which evidence backs it — keeping the authoritative /
 * non-authoritative distinction that the completion invariant depends on.
 *
 * This is a pure projection. It reads real results and derives a view; it does
 * not mutate the Work Unit, store anything, or decide acceptance (acceptance
 * stays human-owned).
 */

import type { BoundedExecutionResult, RepositoryReadback } from './bounded-execution.js'
import type { Evidence, EvidenceKind, EvidenceVerifier } from '../core/model.js'
import type { RunOutcome, VerificationVerdict } from './run-outcome.js'
import type { ProviderExecutionGrant } from './provider-grant.js'

export interface EvidenceReturnItem {
  evidenceId: string
  kind: EvidenceKind
  summary: string
  authoritative: boolean
  /** Which real verifier established this evidence, if any. */
  verifier?: EvidenceVerifier
  /** Verification verdict for this evidence item, if any. */
  verification?: VerificationVerdict
}

export interface RealityChange {
  /** Repository the bounded execution operated on. */
  repository: string
  /** Base ref the grant was pinned to. */
  baseRef: string
  changedFiles: string[]
  executionProducedChanges: string[]
  preExistingDirty: string[]
  scopeViolations: string[]
  gitStatus: string
  testResult?: { passed: boolean | null; output: string }
  beforeTestResult?: { passed: boolean | null; output: string }
  isolated: boolean
  isolationDiscarded: boolean
}

export interface EvidenceReturn {
  ideaId: string
  workUnitId: string
  realityChange: RealityChange
  evidence: EvidenceReturnItem[]
  runOutcome: RunOutcome
  /** Files applied back from the isolation into the real repository. */
  appliedBack: string[]
}

function projectRealityChange(
  readback: RepositoryReadback,
  grant: ProviderExecutionGrant,
): RealityChange {
  const writeTarget = grant.authorization.write_target
  return {
    repository: writeTarget?.repository ?? '<read-only>',
    baseRef: writeTarget?.base_ref ?? '<unspecified>',
    changedFiles: [...readback.changedFiles],
    executionProducedChanges: [...readback.executionProducedChanges],
    preExistingDirty: [...readback.preExistingDirty],
    scopeViolations: [...readback.scopeViolations],
    gitStatus: readback.gitStatus,
    testResult: readback.testResult ? { ...readback.testResult } : undefined,
    beforeTestResult: readback.beforeTestResult ? { ...readback.beforeTestResult } : undefined,
    isolated: readback.isolated,
    isolationDiscarded: readback.isolationDiscarded,
  }
}

function projectEvidenceItem(evidence: Evidence): EvidenceReturnItem {
  return {
    evidenceId: evidence.id,
    kind: evidence.kind,
    summary: evidence.summary,
    authoritative: evidence.authoritative,
    verifier: evidence.verifier,
    verification: evidence.verification,
  }
}

export interface ProjectEvidenceReturnOptions {
  execution: BoundedExecutionResult
  ideaId: string
  grant: ProviderExecutionGrant
}

/**
 * Project one bounded-execution result into the Evidence Return the confirming
 * human receives. The authoritative/non-authoritative split and the verification
 * verdicts come straight from the real evidence the Work Unit already carries;
 * nothing is synthesized here.
 */
export function projectEvidenceReturn(
  options: ProjectEvidenceReturnOptions,
): EvidenceReturn {
  const { execution, ideaId, grant } = options
  return {
    ideaId,
    workUnitId: execution.workUnit.id,
    realityChange: projectRealityChange(execution.repositoryReadback, grant),
    evidence: execution.workUnit.evidence.map(projectEvidenceItem),
    runOutcome: execution.runOutcome,
    appliedBack: [...execution.appliedBack],
  }
}

/** Convenience: the authoritative, verification-passed evidence of a return. */
export function authoritativeEvidence(items: EvidenceReturnItem[]): EvidenceReturnItem[] {
  return items.filter((item) => item.authoritative && item.verification === 'passed')
}
