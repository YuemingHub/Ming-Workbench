import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assertCompletionInvariant,
  canMarkCompleted,
} from '../.tmp/core/model.js'

/**
 * P0-3: Work Unit completion must be backed by REAL verification evidence.
 * The old invariant (gate closed + criterion.satisfied + evidence ids exist)
 * is gone: the free `satisfied` boolean is never trusted, and a
 * Harness/session/model claim can never complete a Work Unit on its own.
 */

function completedUnit(overrides = {}) {
  return {
    id: 'WU-COMPLETE',
    spaceId: 'SPACE-x',
    title: 'complete me',
    outcome: 'do the thing',
    state: 'completed',
    owner: 'development-aaop',
    gate: { kind: 'none', open: false },
    acceptance: [
      {
        id: 'A-1',
        statement: 'the thing is done and verified',
        satisfied: true,
        evidenceIds: ['E-1'],
      },
    ],
    evidence: [],
    assets: [],
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
    ...overrides,
  }
}

function properEvidence(overrides = {}) {
  return {
    id: 'E-1',
    kind: 'test',
    summary: 'Project tests passed (authoritative).',
    observedAt: '2026-08-14T00:00:00.000Z',
    authoritative: true,
    verifier: 'test-run',
    verification: 'passed',
    ...overrides,
  }
}

test('P0-3 case 1: Harness session evidence alone can never complete a Work Unit', () => {
  const unit = completedUnit({
    evidence: [
      {
        ...properEvidence(),
        kind: 'session',
        summary: 'Harness session ended with end_turn.',
        verifier: 'harness-session',
      },
    ],
  })
  assert.equal(canMarkCompleted(unit), false)
  assert.throws(() => assertCompletionInvariant(unit), /verification-backed acceptance/)
})

test('P0-3 case 2: missing evidence cannot complete a Work Unit', () => {
  // The criterion references E-1 but the Work Unit carries no such evidence.
  const unit = completedUnit({ evidence: [] })
  assert.equal(canMarkCompleted(unit), false)
  assert.throws(() => assertCompletionInvariant(unit))
})

test('P0-3 case 3: verification failed cannot complete a Work Unit', () => {
  const unit = completedUnit({
    evidence: [{ ...properEvidence(), verification: 'failed' }],
  })
  assert.equal(canMarkCompleted(unit), false)
  assert.throws(() => assertCompletionInvariant(unit))
})

test('P0-3 case 4: verifier absent cannot complete a Work Unit', () => {
  const unit = completedUnit({
    evidence: [
      {
        ...properEvidence(),
        verifier: undefined,
        verification: 'passed',
      },
    ],
  })
  assert.equal(canMarkCompleted(unit), false)
  assert.throws(() => assertCompletionInvariant(unit))
})

test('P0-3 case 5: proper verification + evidence can complete a Work Unit', () => {
  const unit = completedUnit({ evidence: [properEvidence()] })
  assert.equal(canMarkCompleted(unit), true)
  assert.doesNotThrow(() => assertCompletionInvariant(unit))
})

test('P0-3: the free satisfied boolean alone can never complete a Work Unit', () => {
  const unit = completedUnit({
    // satisfied=true with evidence ids, but the evidence is a bare claim
    // without a verifier or verification verdict.
    evidence: [
      {
        id: 'E-1',
        kind: 'test',
        summary: 'claimed passing',
        observedAt: '2026-08-14T00:00:00.000Z',
        authoritative: true,
      },
    ],
  })
  assert.equal(unit.acceptance[0].satisfied, true)
  assert.equal(canMarkCompleted(unit), false)
  assert.throws(() => assertCompletionInvariant(unit))
})

test('P0-3: an open gate blocks completion regardless of evidence', () => {
  const unit = completedUnit({
    gate: { kind: 'human-decision', open: true, owner: 'human' },
    evidence: [properEvidence()],
  })
  assert.equal(canMarkCompleted(unit), false)
})

test('P0-3: non-authoritative evidence cannot back completion', () => {
  const unit = completedUnit({
    evidence: [
      { ...properEvidence(), authoritative: false, verifier: 'independent-verification' },
    ],
  })
  assert.equal(canMarkCompleted(unit), false)
})

test('P0-3: pending verification cannot back completion', () => {
  const unit = completedUnit({
    evidence: [{ ...properEvidence(), verification: 'pending', verifier: 'test-run' }],
  })
  assert.equal(canMarkCompleted(unit), false)
})

test('P0-3: a completed Work Unit without any acceptance criterion cannot complete', () => {
  const unit = completedUnit({ acceptance: [] })
  assert.equal(canMarkCompleted(unit), false)
})
