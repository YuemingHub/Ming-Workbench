import { randomUUID } from 'node:crypto'

import type { Evidence, WorkUnit } from '../core/model.js'
import {
  assertUserApprovedHandoffV0,
  type UserApprovedHandoffV0,
} from './external-handoff.js'

export interface HandoffToWorkUnitOptions {
  spaceId?: string
  now?: () => Date
  idFactory?: () => string
}

export interface HandoffWorkUnitResult {
  route: 'creation'
  handoff: UserApprovedHandoffV0
  workUnit: WorkUnit
}

function titleFromIntent(intent: string): string {
  const collapsed = intent.trim().replace(/\s+/g, ' ')
  if (collapsed.length <= 72) return collapsed
  return `${collapsed.slice(0, 69)}...`
}

/**
 * Compile an explicitly approved external Handoff into a Workbench-owned
 * Creation Work Unit.
 *
 * V0 is deliberately not routed through `createIntakeWorkUnit` because that
 * factory is development-domain owned and hard-codes `development-aaop`.
 * Keeping this constructor separate is the proof that a simple creation does
 * not become software development merely because its first artifact is HTML.
 */
export function createCreationWorkUnitFromHandoffV0(
  value: unknown,
  options: HandoffToWorkUnitOptions = {},
): HandoffWorkUnitResult {
  const handoff = assertUserApprovedHandoffV0(value)
  const now = options.now ?? (() => new Date())
  const idFactory = options.idFactory ?? (() => randomUUID())
  const timestamp = now().toISOString()
  const workUnitId = `WU-${idFactory()}`
  const spaceId = options.spaceId ?? `SPACE-CREATION-${workUnitId}`

  const handoffEvidence: Evidence = {
    id: `EV-${workUnitId}-HANDOFF`,
    kind: 'human-confirmation',
    summary: `User approved the cross-product handoff at ${handoff.userAuthorization.approvedAt}.`,
    observedAt: handoff.userAuthorization.approvedAt,
    authoritative: true,
    verifier: 'human-confirmation',
    verification: 'passed',
  }

  const workUnit: WorkUnit = {
    id: workUnitId,
    spaceId,
    title: titleFromIntent(handoff.confirmedIntent),
    outcome: handoff.firstOutcome,
    state: 'intake',
    owner: 'creation',
    gate: { kind: 'none', open: false },
    acceptance: [
      {
        id: `AC-${workUnitId}-1`,
        statement: handoff.firstOutcome,
        satisfied: false,
        evidenceIds: [],
      },
    ],
    evidence: [handoffEvidence],
    assets: handoff.resources.map((resource, index) => ({
      id: `AS-${workUnitId}-${index + 1}`,
      kind: 'other',
      title: `User-selected resource ${index + 1}`,
      uri: resource,
    })),
    nextFrontier: 'Resolve a Creation capability provider for the confirmed first outcome.',
    createdAt: timestamp,
    updatedAt: timestamp,
  }

  return {
    route: 'creation',
    handoff,
    workUnit,
  }
}
