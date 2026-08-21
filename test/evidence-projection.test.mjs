import test from 'node:test'
import assert from 'node:assert/strict'

import { projectEvidenceReturn, authoritativeEvidence } from '../.tmp/execution/evidence-projection.js'

function grant(repository = '/projects/scratch', baseRef = 'abc123') {
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
      write_target: { repository, base_ref: baseRef, working_ref: 'main', environment: null },
      allowed_effects: ['local-file-write'],
      protected_effects: ['deploy'],
    },
    acceptance_evidence: [],
    human_open_questions: [],
    references: ['work-unit:WU-001'],
    issued_at: '2026-08-21T10:02:00.000Z',
  }
}

function executionResult({ authoritativeVerification = 'passed', producedChanges = ['README.md'], scopeViolations = [] } = {}) {
  return {
    workUnit: {
      id: 'WU-001',
      spaceId: 'SPACE-dev',
      title: 'Change README Version from OLD to NEW',
      outcome: 'README contains Version: NEW',
      state: 'verifying',
      owner: 'development-aaop',
      gate: { kind: 'none', open: false },
      acceptance: [],
      evidence: [
        { id: 'EV-EXEC-1', kind: 'repository', summary: 'session record', observedAt: '2026-08-21T10:04:00.000Z', authoritative: false, verifier: 'harness-session', verification: 'pending' },
        { id: 'EV-GIT-1', kind: 'test', summary: 'readback passed', observedAt: '2026-08-21T10:04:00.000Z', authoritative: true, verifier: 'test-run', verification: authoritativeVerification },
      ],
      assets: [],
      createdAt: '2026-08-21T10:00:00.000Z',
      updatedAt: '2026-08-21T10:05:00.000Z',
    },
    sessionId: 'SESS-1',
    stopReason: 'end_turn',
    assistantText: 'done',
    frontierDecision: 'proceed',
    reconciliation: { decision: 'proceed' },
    repositoryReadback: {
      changedFiles: producedChanges,
      executionProducedChanges: producedChanges,
      preExistingDirty: [],
      scopeViolations,
      gitStatus: 'modified',
      isolated: true,
      isolationDiscarded: false,
    },
    runOutcome: { runStatus: 'completed', effect: 'mutation-observed', verification: authoritativeVerification, acceptance: 'pending', reason: 'readback' },
    isolation: { worktree: '/tmp/iso', discarded: false },
    appliedBack: producedChanges,
  }
}

test('projectEvidenceReturn keeps authoritative and non-authoritative evidence distinct', () => {
  const ret = projectEvidenceReturn({ execution: executionResult(), ideaId: 'idea-1', grant: grant() })
  const authoritative = ret.evidence.filter((e) => e.authoritative)
  const nonAuthoritative = ret.evidence.filter((e) => !e.authoritative)
  assert.equal(authoritative.length, 1)
  assert.equal(authoritative[0].evidenceId, 'EV-GIT-1')
  assert.equal(authoritative[0].verifier, 'test-run')
  assert.equal(authoritative[0].verification, 'passed')
  assert.equal(nonAuthoritative.length, 1)
  assert.equal(nonAuthoritative[0].evidenceId, 'EV-EXEC-1')
  assert.equal(nonAuthoritative[0].verification, 'pending')
})

test('projectEvidenceReturn reality change comes from the real readback and grant target', () => {
  const ret = projectEvidenceReturn({ execution: executionResult(), ideaId: 'idea-1', grant: grant('/projects/scratch', 'abc123') })
  assert.equal(ret.realityChange.repository, '/projects/scratch')
  assert.equal(ret.realityChange.baseRef, 'abc123')
  assert.deepEqual(ret.realityChange.executionProducedChanges, ['README.md'])
  assert.deepEqual(ret.realityChange.scopeViolations, [])
  assert.equal(ret.realityChange.isolated, true)
  assert.equal(ret.realityChange.isolationDiscarded, false)
})

test('projectEvidenceReturn run outcome verdict passes through without loss', () => {
  const ret = projectEvidenceReturn({ execution: executionResult(), ideaId: 'idea-1', grant: grant() })
  assert.equal(ret.runOutcome.verification, 'passed')
  assert.equal(ret.runOutcome.acceptance, 'pending')
  assert.equal(ret.runOutcome.effect, 'mutation-observed')
})

test('projectEvidenceReturn appliedBack lists what reached the real repository', () => {
  const ret = projectEvidenceReturn({ execution: executionResult(), ideaId: 'idea-1', grant: grant() })
  assert.deepEqual(ret.appliedBack, ['README.md'])
})

test('projectEvidenceReturn surfaces scope violations honestly', () => {
  const ret = projectEvidenceReturn({ execution: executionResult({ scopeViolations: ['SECRET.env'] }), ideaId: 'idea-1', grant: grant() })
  assert.deepEqual(ret.realityChange.scopeViolations, ['SECRET.env'])
})

test('authoritativeEvidence helper returns only authoritative passed evidence', () => {
  const ret = projectEvidenceReturn({ execution: executionResult(), ideaId: 'idea-1', grant: grant() })
  const backing = authoritativeEvidence(ret.evidence)
  assert.equal(backing.length, 1)
  assert.equal(backing[0].evidenceId, 'EV-GIT-1')
  const failed = authoritativeEvidence(projectEvidenceReturn({ execution: executionResult({ authoritativeVerification: 'failed' }), ideaId: 'idea-1', grant: grant() }).evidence)
  assert.equal(failed.length, 0)
})
