import { canMarkCompleted, type WorkUnit } from '../core/model.js'
import {
  EXTERNAL_HANDOFF_VERSION,
  type ReturnPacketV0,
  type UserApprovedHandoffV0,
} from '../handoff/external-handoff.js'

export interface BuildReturnPacketOptions {
  humanFeedback?: string[]
  openQuestions?: string[]
  now?: () => Date
}

/**
 * Build the minimum Ming → Return-to-oneself packet after a Creation outcome is
 * truly completed.
 *
 * Technical execution logs, provider names, local paths and internal capability
 * decisions deliberately do not cross this product boundary.
 */
export function buildCreationReturnPacketV0(
  handoff: UserApprovedHandoffV0,
  workUnit: WorkUnit,
  options: BuildReturnPacketOptions = {},
): ReturnPacketV0 {
  if (!handoff.returnRequested) {
    throw new Error('The person did not request a return to the source product.')
  }
  if (workUnit.owner !== 'creation') {
    throw new Error('Only a Creation Work Unit can produce a Creation Return Packet.')
  }
  if (workUnit.state !== 'completed' || !canMarkCompleted(workUnit)) {
    throw new Error('Creation outcome is not completed with verification-backed human acceptance.')
  }

  const hasArtifactVerification = workUnit.evidence.some(
    (evidence) =>
      evidence.kind === 'artifact'
      && evidence.authoritative
      && evidence.verifier === 'independent-verification'
      && evidence.verification === 'passed',
  )
  const hasHumanAcceptance = workUnit.evidence.some(
    (evidence) =>
      evidence.kind === 'human-confirmation'
      && evidence.id.endsWith('HUMAN-ACCEPTANCE')
      && evidence.authoritative
      && evidence.verification === 'passed',
  )
  if (!hasArtifactVerification || !hasHumanAcceptance) {
    throw new Error('Creation Return Packet requires both artifact verification and explicit human acceptance.')
  }

  const evidenceSummary = [
    '本轮成果已产生，并经过独立现实读取确认。',
    '使用者已亲自过目并明确接受这一版成果。',
  ]

  return {
    schemaVersion: EXTERNAL_HANDOFF_VERSION,
    kind: 'return-packet',
    sourceProduct: 'Ming',
    targetProduct: 'Return-to-oneself',
    originalIntent: handoff.confirmedIntent,
    actualOutcome: workUnit.outcome,
    evidenceSummary,
    humanFeedback: [...(options.humanFeedback ?? [])],
    openQuestions: [...(options.openQuestions ?? [])],
    createdAt: (options.now ?? (() => new Date()))().toISOString(),
  }
}
