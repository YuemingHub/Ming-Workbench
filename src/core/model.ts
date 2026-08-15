import type { VerificationVerdict } from '../execution/run-outcome.js'

export type WorkUnitState =
  | 'intake'
  | 'ready'
  | 'running'
  | 'waiting'
  | 'needs-human'
  | 'verifying'
  | 'completed'
  | 'blocked'
  | 'cancelled'

export type GateKind =
  | 'human-decision'
  | 'authorization'
  | 'credential'
  | 'cost'
  | 'external-wait'
  | 'safety'
  | 'none'

export interface Space {
  id: string
  title: string
  domainPackId: string
  createdAt: string
}

export interface Gate {
  kind: GateKind
  open: boolean
  summary?: string
  owner?: 'human' | 'agent' | 'external'
}

/**
 * Who/what established an evidence item. P0-3: a Harness/session/model claim
 * can never back Work Unit completion on its own.
 */
export type EvidenceVerifier =
  | 'harness-session'
  | 'repository-observation'
  | 'test-run'
  | 'independent-verification'
  | 'human-confirmation'

export type EvidenceKind =
  | 'repository'
  | 'test'
  | 'ci'
  | 'runtime'
  | 'deployment'
  | 'artifact'
  | 'session'
  | 'human-confirmation'

export interface Evidence {
  id: string
  kind: EvidenceKind
  summary: string
  uri?: string
  observedAt: string
  authoritative: boolean
  /** P0-3: which real verifier established this evidence. */
  verifier?: EvidenceVerifier
  /** P0-3: verification verdict for this evidence item. */
  verification?: VerificationVerdict
}

export interface Asset {
  id: string
  kind: 'code' | 'document' | 'media' | 'dataset' | 'decision' | 'other'
  title: string
  uri?: string
}

export interface AcceptanceCriterion {
  id: string
  statement: string
  satisfied: boolean
  evidenceIds: string[]
}

export interface WorkUnit {
  id: string
  spaceId: string
  title: string
  outcome: string
  state: WorkUnitState
  owner: string
  gate: Gate
  acceptance: AcceptanceCriterion[]
  evidence: Evidence[]
  assets: Asset[]
  nextFrontier?: string
  createdAt: string
  updatedAt: string
}

/** Verifiers that can back Work Unit completion with real verification. */
const COMPLETION_BACKING_VERIFIERS = new Set<EvidenceVerifier>([
  'repository-observation',
  'test-run',
  'independent-verification',
  'human-confirmation',
])

/**
 * P0-3: one evidence item backs acceptance only when it was established by a
 * REAL verifier with a PASSED verification verdict. A Harness/session/model
 * claim (verifier 'harness-session', or no verifier at all) never suffices,
 * and the free `criterion.satisfied` boolean is deliberately not trusted.
 */
function evidenceBacksAcceptance(unit: WorkUnit, evidenceId: string): boolean {
  const evidence = unit.evidence.find((item) => item.id === evidenceId)
  if (!evidence) return false
  if (!evidence.authoritative) return false
  if (!evidence.verifier || !COMPLETION_BACKING_VERIFIERS.has(evidence.verifier)) return false
  if (evidence.verification !== 'passed') return false
  return true
}

export function canMarkCompleted(unit: WorkUnit): boolean {
  if (unit.gate.open) return false
  if (unit.acceptance.length === 0) return false
  // The `satisfied` boolean is a display hint at most; completion requires
  // verification-backed evidence on every referenced evidence id.
  return unit.acceptance.every((criterion) => {
    if (criterion.evidenceIds.length === 0) return false
    return criterion.evidenceIds.every((id) => evidenceBacksAcceptance(unit, id))
  })
}

export function assertCompletionInvariant(unit: WorkUnit): void {
  if (unit.state !== 'completed') return
  if (!canMarkCompleted(unit)) {
    throw new Error(
      `WorkUnit ${unit.id} is completed without closed gates and verification-backed acceptance evidence.`,
    )
  }
}
