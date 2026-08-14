import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  computeExecutionDelta,
  readRepositorySnapshot,
  reconcileBeforeMutation,
  reconcileExternalEffect,
} from '../.tmp/execution/repository.js'
import { classifyExternalEffect } from '../.tmp/execution/bounded-execution.js'
import { deriveRunOutcome } from '../.tmp/execution/run-outcome.js'
import { issueProviderExecutionGrant } from '../.tmp/execution/grant-issuance.js'
import {
  buildExactSlice,
  buildWholeRepositorySlice,
} from '../.tmp/execution/mutation-slice.js'

function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'mw-repo-'))
  execFileSync('git', ['-C', dir, 'init', '-q'])
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@example.com'])
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'tester'])
  writeFileSync(join(dir, 'seed.txt'), 'seed')
  execFileSync('git', ['-C', dir, 'add', '.'])
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'init'])
  return dir
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

function minimalWorkUnit(id = 'WU-1', outcome = 'fix the test') {
  return {
    id,
    spaceId: 'SPACE-x',
    title: outcome,
    outcome,
    state: 'ready',
    owner: 'development-aaop',
    gate: { kind: 'none', open: false },
    acceptance: [],
    evidence: [],
    assets: [],
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
  }
}

test('computeExecutionDelta excludes pre-existing dirty files from execution-produced changes', () => {
  const dir = makeRepo()
  try {
    writeFileSync(join(dir, 'pre.txt'), 'pre-existing')
    const before = readRepositorySnapshot(dir)
    writeFileSync(join(dir, 'post.txt'), 'produced-by-execution')
    const after = readRepositorySnapshot(dir)
    const delta = computeExecutionDelta(before, after, buildWholeRepositorySlice(dir, before.head))
    assert.deepEqual(delta.executionProducedChanges.sort(), ['post.txt'])
    assert.deepEqual(delta.preExistingDirty.sort(), ['pre.txt'])
    assert.equal(delta.scopeViolations.length, 0)
  } finally {
    cleanup(dir)
  }
})

test('computeExecutionDelta flags changes outside the granted repository root as scope violations', () => {
  const dir = makeRepo()
  const outside = mkdtempSync(join(tmpdir(), 'mw-outside-'))
  try {
    writeFileSync(join(dir, 'inside.txt'), 'changed')
    const before = readRepositorySnapshot(dir)
    const after = readRepositorySnapshot(dir)
    // Grant scope is a DIFFERENT directory, so the change is out of scope.
    const delta = computeExecutionDelta(before, after, buildWholeRepositorySlice(outside, ''))
    assert.ok(delta.scopeViolations.includes('inside.txt'))
  } finally {
    cleanup(dir)
    cleanup(outside)
  }
})

test('computeExecutionDelta attributes a committed HEAD move to this execution', () => {
  const dir = makeRepo()
  try {
    const before = readRepositorySnapshot(dir)
    writeFileSync(join(dir, 'committed.txt'), 'c')
    execFileSync('git', ['-C', dir, 'add', '.'])
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'exec change'])
    const after = readRepositorySnapshot(dir)
    const delta = computeExecutionDelta(before, after, buildWholeRepositorySlice(dir, before.head))
    assert.equal(delta.headChanged, true)
    assert.ok(delta.executionProducedChanges.includes('committed.txt'))
  } finally {
    cleanup(dir)
  }
})

test('reconcileBeforeMutation blocks when HEAD diverges from the granted base_ref', () => {
  const dir = makeRepo()
  try {
    const snapshot = readRepositorySnapshot(dir)
    const slice = buildExactSlice(dir, snapshot.head, ['seed.txt'])
    const { grant } = issueProviderExecutionGrant({ workUnit: minimalWorkUnit(), projectRoot: dir, snapshot, slice })
    // Move HEAD away from the granted base_ref.
    writeFileSync(join(dir, 'second.txt'), 's')
    execFileSync('git', ['-C', dir, 'add', '.'])
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'second'])
    const rec = reconcileBeforeMutation(readRepositorySnapshot(dir), grant, slice)
    assert.equal(rec.safeToStart, false)
    assert.match(rec.reason, /base_ref/)
  } finally {
    cleanup(dir)
  }
})

test('reconcileBeforeMutation blocks a non-Git project', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mw-nogit-'))
  try {
    const snapshot = { root: dir, head: '', isGit: false, dirtyFiles: [] }
    const slice = buildWholeRepositorySlice(dir, '')
    const fakeGrant = issueProviderExecutionGrant({
      workUnit: minimalWorkUnit(),
      projectRoot: dir,
      snapshot,
      slice,
    }).grant
    const rec = reconcileBeforeMutation(readRepositorySnapshot(dir), fakeGrant, slice)
    assert.equal(rec.safeToStart, false)
  } finally {
    cleanup(dir)
  }
})

test('reconcileExternalEffect inspects the real target repo via git -C, not the cwd', () => {
  const target = makeRepo()
  const other = makeRepo()
  try {
    writeFileSync(join(target, 'dirty.txt'), 'd')
    const onTarget = reconcileExternalEffect('local-git', target, {})
    assert.equal(onTarget.status, 'success')
    const onOther = reconcileExternalEffect('local-git', other, {})
    assert.equal(onOther.status, 'failure')
  } finally {
    cleanup(target)
    cleanup(other)
  }
})

test('deriveRunOutcome does NOT count pre-existing dirty files as execution success', () => {
  const readback = {
    changedFiles: ['pre.txt'],
    executionProducedChanges: [],
    preExistingDirty: ['pre.txt'],
    scopeViolations: [],
    testResult: { passed: false, output: '' },
    beforeTestResult: { passed: false, output: '' },
    gitStatus: 'modified',
  }
  const outcome = deriveRunOutcome({
    producedChanges: readback.executionProducedChanges,
    scopeViolations: readback.scopeViolations,
    testsPassedAfter: readback.testResult.passed,
    testsPassedBefore: readback.beforeTestResult.passed,
    hasExternalEffects: false,
  })
  assert.equal(outcome.effect, 'no-mutation')
  assert.equal(outcome.verification, 'failed')
  assert.notEqual(outcome.acceptance, 'accepted')
})

test('deriveRunOutcome: mutation with failing tests is verification failure, never success (P0-2 B)', () => {
  const outcome = deriveRunOutcome({
    producedChanges: ['post.txt'],
    scopeViolations: [],
    testsPassedAfter: false,
    testsPassedBefore: false,
    hasExternalEffects: false,
  })
  assert.equal(outcome.effect, 'mutation-observed')
  assert.equal(outcome.verification, 'failed')
  assert.equal(outcome.acceptance, 'rejected')
})

test('deriveRunOutcome: mutation with passing tests is verification passed, acceptance stays pending (P0-2 C)', () => {
  const outcome = deriveRunOutcome({
    producedChanges: ['post.txt'],
    scopeViolations: [],
    testsPassedAfter: true,
    testsPassedBefore: false,
    hasExternalEffects: false,
  })
  assert.equal(outcome.effect, 'mutation-observed')
  assert.equal(outcome.verification, 'passed')
  // A completed run never yields acceptance — accepted is human-owned.
  assert.equal(outcome.acceptance, 'pending')
  assert.equal(outcome.runStatus, 'completed')
})

test('deriveRunOutcome: pre-green no-op run is not task success (P0-2 A)', () => {
  const outcome = deriveRunOutcome({
    producedChanges: [],
    scopeViolations: [],
    testsPassedAfter: true,
    testsPassedBefore: true,
    hasExternalEffects: false,
  })
  assert.equal(outcome.effect, 'no-mutation')
  assert.equal(outcome.verification, 'inconclusive')
  assert.equal(outcome.acceptance, 'pending')
})

test('deriveRunOutcome fails on scope violations', () => {
  const outcome = deriveRunOutcome({
    producedChanges: ['evil.txt'],
    scopeViolations: ['evil.txt'],
    testsPassedAfter: false,
    testsPassedBefore: false,
    hasExternalEffects: false,
  })
  assert.equal(outcome.verification, 'failed')
  assert.equal(outcome.acceptance, 'rejected')
})

test('classifyExternalEffect is a thin four-axis wrapper over deriveRunOutcome', () => {
  const grant = { authorization: { allowed_effects: ['local-file-write'], protected_effects: [] } }
  const readback = {
    changedFiles: ['post.txt'],
    executionProducedChanges: ['post.txt'],
    preExistingDirty: [],
    scopeViolations: [],
    testResult: { passed: true, output: '' },
    beforeTestResult: { passed: false, output: '' },
    gitStatus: 'modified',
  }
  const outcome = classifyExternalEffect(readback, grant)
  assert.equal(outcome.runStatus, 'completed')
  assert.equal(outcome.effect, 'mutation-observed')
  assert.equal(outcome.verification, 'passed')
})
