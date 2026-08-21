/**
 * Harness doubles for the first closed loop.
 *
 * The reviewed DeepSeek Harness ACP transport (and a real provider) is the one
 * genuine external dependency of the loop. `runDevelopmentIntakeApplication`
 * and `runBoundedExecution` both expose official injection seams
 * (`dependencies.runCoordinator` and `dependencies.runHarnessAcpGrant`), so
 * these doubles replace ONLY the two LLM sessions — the intake coordinator
 * session and the execution grant session. Everything else (onboarding,
 * manifest, the real AAOP bridge subprocess, grant issuance, the mutation
 * slice, the disposable git isolation, repository readback, run-outcome
 * derivation, and evidence production) runs for real.
 *
 * - The coordinator double builds a grounded AAOP Intake Envelope and runs it
 *   through the REAL `parseAaopIntakeEnvelope` validator and the REAL
 *   `reconcileAaopCoordinatorWorkUnit` reconciler. Only the model call is gone.
 * - The grant-run double performs a REAL file write inside the disposable
 *   isolation worktree (`options.cwd`), so the real isolation → delta → apply →
 *   readback → evidence chain observes a real mutation and a real git diff.
 */

import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { parseAaopIntakeEnvelope } from '../../.tmp/intake/aaop-envelope.js'
import { reconcileAaopCoordinatorWorkUnit } from '../../.tmp/intake/coordinator.js'

/**
 * Build a coordinator double that returns a grounded AAOP Intake Envelope.
 *
 * Defaults describe the README version-bump scenario used by the architecture
 * tests. `overrides` lets a corpus case describe a different real goal's
 * situation/route/next_action without rewriting the double — the double is the
 * LLM stand-in, and different goals legitimately need different "what a
 * correct AAOP coordinator would return". `raw_request` is always forced to the
 * prepared request so the envelope stays consistent with the Work Unit.
 */
export function createCoordinatorDouble(overrides = {}) {
  return async (options) => {
    const rawRequest = options.prepared.aaopRequest.rawRequest
    const envelope = {
      schema_version: '1.0',
      generated_at: new Date().toISOString(),
      raw_request: rawRequest,
      situation: 'existing_repository',
      route: 'feature-change',
      route_confidence: 0.9,
      ambiguities: [],
      question_needed: null,
      project_evidence_summary: ['README.md — 当前版本占位，授权内一次写入'],
      next_action: 'Authorize a bounded write to README.md to set Version: NEW.',
      ...overrides,
      raw_request: rawRequest,
    }
    const json = JSON.stringify(envelope)
    const parsed = parseAaopIntakeEnvelope(json)
    const now = (options.now ?? (() => new Date()))()
    const sessionId = `SESS-INTAKE-DOUBLE-${randomUUID()}`
    const workUnit = reconcileAaopCoordinatorWorkUnit(
      options.prepared.workUnit,
      parsed,
      sessionId,
      now,
    )
    return {
      workUnit,
      envelope: parsed,
      sessionId,
      stopReason: 'end_turn',
      assistantText: json,
    }
  }
}

/**
 * Build a grant-run double that performs a REAL write of `targetFile` inside
 * the disposable isolation worktree (`options.cwd`) with `newContent`. The real
 * bounded-execution machinery then observes the mutation, applies it back to
 * the real repository, and derives evidence from it.
 */
export function createGrantRunDouble({ targetFile = 'README.md', newContent } = {}) {
  return async (options) => {
    const target = join(options.cwd, targetFile)
    writeFileSync(target, newContent, 'utf8')
    return {
      sessionId: `SESS-EXEC-DOUBLE-${randomUUID()}`,
      stopReason: 'end_turn',
      assistantText: `Applied the authorized change to ${targetFile}.`,
    }
  }
}
