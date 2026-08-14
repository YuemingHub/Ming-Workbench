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

export interface Evidence {
  id: string
  kind:
    | 'repository'
    | 'test'
    | 'ci'
    | 'runtime'
    | 'deployment'
    | 'artifact'
    | 'session'
    | 'human-confirmation'
  summary: string
  uri?: string
  observedAt: string
  authoritative: boolean
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

export function canMarkCompleted(unit: WorkUnit): boolean {
  if (unit.gate.open) return false
  if (unit.acceptance.length === 0) return false
  return unit.acceptance.every((criterion) => {
    if (!criterion.satisfied || criterion.evidenceIds.length === 0) return false
    return criterion.evidenceIds.every((id) =>
      unit.evidence.some((evidence) => evidence.id === id),
    )
  })
}

export function assertCompletionInvariant(unit: WorkUnit): void {
  if (unit.state !== 'completed') return
  if (!canMarkCompleted(unit)) {
    throw new Error(
      `WorkUnit ${unit.id} is completed without closed gates and evidence-backed acceptance.`,
    )
  }
}
