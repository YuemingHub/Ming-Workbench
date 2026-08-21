import test from 'node:test'
import assert from 'node:assert/strict'

import { buildExecutionRun } from '../.tmp/execution/execution-run.js'

function workUnit(id = 'WU-001') {
  return {
    id,
    spaceId: 'SPACE-dev',
    title: 'Change README Version from OLD to NEW',
    outcome: 'README contains Version: NEW',
    state: 'verifying',
    owner: 'development-aaop',
    gate: { kind: 'none', open: false },
    acceptance: [],
    evidence: [],
    assets: [],
    nextFrontier: undefined,
    createdAt: '2026-08-21T10:00:00.000Z',
    updatedAt: '2026-08-21T10:05:00.000Z',
  }
}

function intakeEnvelope(rawRequest = 'README contains Version: NEW') {
  return {
    schema_version: '1.0',
    generated_at: '2026-08-21T10:01:00.000Z',
    raw_request: rawRequest,
    situation: 'feature-change',
    route: 'feature-change',
    route_confidence: 0.9,
    ambiguities: [],
    question_needed: null,
    project_evidence_summary: ['README.md — 当前版本占位'],
    next_action: 'Authorize a bounded write to README.md',
  }
}

function intakeResult() {
  return {
    workUnit: workUnit(),
    envelope: intakeEnvelope(),
    sessionId: 'SESS-intake-001',
    stopReason: 'end_turn',
    assistantText: '{}',
  }
}

function grant() {
  return {
    schema_version: '1.0',
    grant_id: 'GRANT-001',
    provider: 'deepseek-harness',
    route: 'feature-change',
    working_contract_revision: 1,
    goal: 'README contains Version: NEW',
    baseline: ['abc123'],
    execution_mode: 'single-agent',
    task_pod: null,
    tasks: [],
    authorization: {
      mutation_boundary: 'write-authorized',
      write_target: { repository: '/projects/scratch', base_ref: 'abc123', working_ref: 'main', environment: null },
      allowed_effects: ['local-file-write'],
      protected_effects: ['deploy'],
    },
    acceptance_evidence: [],
    human_open_questions: [],
    references: ['work-unit:WU-001'],
    issued_at: '2026-08-21T10:02:00.000Z',
  }
}

function executionResult() {
  return {
    workUnit: { ...workUnit(), evidence: [{ id: 'EV-GIT-SESS-001', kind: 'test', summary: 'readback passed', observedAt: '2026-08-21T10:04:00.000Z', authoritative: true, verifier: 'test-run', verification: 'passed' }] },
    sessionId: 'SESS-exec-001',
    stopReason: 'end_turn',
    assistantText: 'Applied README Version: NEW',
    frontierDecision: 'proceed',
    reconciliation: { decision: 'proceed' },
    repositoryReadback: {
      changedFiles: ['README.md'],
      executionProducedChanges: ['README.md'],
      preExistingDirty: [],
      scopeViolations: [],
      gitStatus: 'modified',
      isolated: true,
      isolationDiscarded: false,
    },
    runOutcome: { runStatus: 'completed', effect: 'mutation-observed', verification: 'passed', acceptance: 'pending', reason: 'readback' },
    isolation: { worktree: '/tmp/iso', discarded: false },
    appliedBack: ['README.md'],
  }
}

test('buildExecutionRun correlates idea -> workUnit -> grant -> session ids', () => {
  const run = buildExecutionRun({
    ideaId: 'idea-1',
    intake: intakeResult(),
    grant: grant(),
    execution: executionResult(),
    now: () => new Date('2026-08-21T10:06:00.000Z'),
  })

  assert.equal(run.ideaId, 'idea-1')
  assert.equal(run.workUnitId, 'WU-001')
  assert.equal(run.grantId, 'GRANT-001')
  assert.equal(run.sessionId, 'SESS-exec-001')
})

test('buildExecutionRun carries the AAOP intake envelope through unchanged', () => {
  const envelope = intakeEnvelope()
  const run = buildExecutionRun({
    ideaId: 'idea-1',
    intake: { ...intakeResult(), envelope },
    grant: grant(),
    execution: executionResult(),
    now: () => new Date('2026-08-21T10:06:00.000Z'),
  })
  assert.equal(run.intakeEnvelope, envelope)
  assert.equal(run.intakeEnvelope.raw_request, 'README contains Version: NEW')
})

test('buildExecutionRun timestamps span intake creation to run completion', () => {
  const run = buildExecutionRun({
    ideaId: 'idea-1',
    intake: intakeResult(),
    grant: grant(),
    execution: executionResult(),
    now: () => new Date('2026-08-21T10:06:00.000Z'),
  })
  assert.equal(run.startedAt, '2026-08-21T10:00:00.000Z')
  assert.equal(run.completedAt, '2026-08-21T10:06:00.000Z')
})

test('buildExecutionRun run id is RUN- prefixed and uses the injected id factory', () => {
  const run = buildExecutionRun({
    ideaId: 'idea-1',
    intake: intakeResult(),
    grant: grant(),
    execution: executionResult(),
    now: () => new Date('2026-08-21T10:06:00.000Z'),
    idFactory: () => 'fixed-uuid',
  })
  assert.equal(run.id, 'RUN-fixed-uuid')
})

test('buildExecutionRun passes the full execution result through without fabricating fields', () => {
  const execution = executionResult()
  const run = buildExecutionRun({
    ideaId: 'idea-1',
    intake: intakeResult(),
    grant: grant(),
    execution,
    now: () => new Date('2026-08-21T10:06:00.000Z'),
  })
  assert.equal(run.execution, execution)
  assert.equal(run.execution.runOutcome.verification, 'passed')
  assert.equal(run.execution.runOutcome.acceptance, 'pending')
  assert.deepEqual(run.execution.repositoryReadback.executionProducedChanges, ['README.md'])
})
