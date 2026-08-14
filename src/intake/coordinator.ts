import type { WorkUnit } from '../core/model.js'
import {
  runHarnessAcpReadOnlyIntake,
  type HarnessAcpRunResult,
} from '../transports/harness-acp.js'
import type { PreparedProjectIntake } from './project-aaop.js'
import {
  parseAaopIntakeEnvelope,
  type AaopIntakeEnvelope,
} from './aaop-envelope.js'

type ReadyPreparedProjectIntake = Extract<
  PreparedProjectIntake,
  { status: 'ready-for-aaop-coordinator' }
>

export interface RunAaopCoordinatorOptions {
  prepared: ReadyPreparedProjectIntake
  projectRoot: string
  harnessCheckout: string
  workbenchRoot: string
  provider?: string
  model?: string
  sessionRoot?: string
  now?: () => Date
}

export interface AaopCoordinatorResult {
  workUnit: WorkUnit
  envelope: AaopIntakeEnvelope
  sessionId: string
  stopReason: HarnessAcpRunResult['stopReason']
  assistantText: string
}

export function renderAaopCoordinatorPrompt(
  prepared: ReadyPreparedProjectIntake,
): string {
  return [
    prepared.coordinatorMessage,
    '',
    '[AAOP_CANONICAL_INTAKE_ENVELOPE_OUTPUT_CONTRACT]',
    'Return ONLY one JSON object. No prose before or after it. No Markdown except an optional single ```json fence around the one object.',
    'The JSON object MUST contain exactly these fields and no others:',
    '{',
    '  "schema_version": "1.0",',
    '  "generated_at": "<non-empty timestamp string>",',
    `  "raw_request": ${JSON.stringify(prepared.aaopRequest.rawRequest)},`,
    '  "situation": "idea | existing_repository | defect_failure | release_operations | understanding_review",',
    '  "route": "idea-to-build | repo-recovery | bug-fix | feature-change | understand-review | release-operations",',
    '  "route_confidence": 0.0,',
    '  "ambiguities": [],',
    '  "question_needed": null,',
    '  "project_evidence_summary": [],',
    '  "next_action": "<one grounded next action>"',
    '}',
    'Rules:',
    '- raw_request MUST exactly equal the Workbench raw request shown above.',
    '- route_confidence MUST be between 0 and 1.',
    '- question_needed is null unless a genuinely human-owned decision remains after repository inspection.',
    '- Do not ask the human to choose files, frameworks, agents, providers, or other engineering details that current evidence/AAOP can resolve.',
    '- project_evidence_summary contains concise current repository evidence, not speculation.',
    '- next_action describes the next AAOP control step; it is not permission to mutate the repository.',
    '- This read-only session must not modify files, branches, refs, remotes, credentials, deployments, or external systems.',
    '[/AAOP_CANONICAL_INTAKE_ENVELOPE_OUTPUT_CONTRACT]',
  ].join('\n')
}

export function assertAaopEnvelopeMatchesRequest(
  envelope: AaopIntakeEnvelope,
  rawRequest: string,
): void {
  if (envelope.raw_request !== rawRequest) {
    throw new Error(
      `AAOP Intake Envelope raw_request mismatch: expected ${JSON.stringify(rawRequest)}, received ${JSON.stringify(envelope.raw_request)}.`,
    )
  }
}

export function reconcileAaopCoordinatorWorkUnit(
  source: WorkUnit,
  envelope: AaopIntakeEnvelope,
  sessionId: string,
  now: Date,
): WorkUnit {
  const hasHumanQuestion = envelope.question_needed !== null
  const evidenceId = `EV-AAOP-INTAKE-${sessionId}`

  return {
    ...source,
    state: hasHumanQuestion ? 'needs-human' : 'ready',
    owner: 'development-aaop',
    gate: hasHumanQuestion
      ? {
          kind: 'human-decision',
          open: true,
          summary: envelope.question_needed ?? undefined,
        }
      : { kind: 'none', open: false },
    evidence: [
      ...source.evidence,
      {
        id: evidenceId,
        kind: 'session',
        summary: `Read-only AAOP Developer Intake session derived route ${envelope.route} at confidence ${envelope.route_confidence}. This is coordination evidence, not product truth or completion evidence.`,
        uri: `deepseek-harness-acp:${sessionId}`,
        observedAt: now.toISOString(),
        authoritative: false,
      },
    ],
    nextFrontier: hasHumanQuestion
      ? envelope.question_needed ?? undefined
      : envelope.next_action,
    updatedAt: now.toISOString(),
  }
}

/**
 * Run one prepared ordinary-language Work Unit through a dedicated read-only
 * Harness coordinator session and accept only AAOP's canonical Intake Envelope.
 * This function does not authorize mutation or create a Provider Execution Grant.
 */
export async function runProjectAaopCoordinator(
  options: RunAaopCoordinatorOptions,
): Promise<AaopCoordinatorResult> {
  const prompt = renderAaopCoordinatorPrompt(options.prepared)
  const result = await runHarnessAcpReadOnlyIntake({
    prompt,
    cwd: options.projectRoot,
    harnessCheckout: options.harnessCheckout,
    workbenchRoot: options.workbenchRoot,
    provider: options.provider,
    model: options.model,
    sessionRoot: options.sessionRoot,
  })

  if (result.stopReason !== 'end_turn') {
    throw new Error(
      `AAOP Developer Intake coordinator did not reach a complete end_turn: ${result.stopReason}`,
    )
  }

  const envelope = parseAaopIntakeEnvelope(result.assistantText)
  assertAaopEnvelopeMatchesRequest(envelope, options.prepared.aaopRequest.rawRequest)

  const now = (options.now ?? (() => new Date()))()
  const workUnit = reconcileAaopCoordinatorWorkUnit(
    options.prepared.workUnit,
    envelope,
    result.sessionId,
    now,
  )

  return {
    workUnit,
    envelope,
    sessionId: result.sessionId,
    stopReason: result.stopReason,
    assistantText: result.assistantText,
  }
}
