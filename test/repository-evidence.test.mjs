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
import { issueProviderExecutionGrant } from '../.tmp/execution/grant-issuance.js'

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
    const delta = computeExecutionDelta(before, after, dir)
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
    const delta = computeExecutionDelta(before, after, outside)
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
    const delta = computeExecutionDelta(before, after, dir)
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
    const { grant } = issueProviderExecutionGrant({ workUnit: minimalWorkUnit(), projectRoot: dir, snapshot })
    // Move HEAD away from the granted base_ref.
    writeFileSync(join(dir, 'second.txt'), 's')
    execFileSync('git', ['-C', dir, 'add', '.'])
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'second'])
    const rec = reconcileBeforeMutation(readRepositorySnapshot(dir), grant)
    assert.equal(rec.safeToStart, false)
    assert.match(rec.reason, /base_ref/)
  } finally {
    cleanup(dir)
  }
})

test('reconcileBeforeMutation blocks a non-Git project', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mw-nogit-'))
  try {
    const fakeGrant = issueProviderExecutionGrant({
      workUnit: minimalWorkUnit(),
      projectRoot: dir,
      snapshot: { root: dir, head: '', isGit: false, dirtyFiles: [] },
    }).grant
    const rec = reconcileBeforeMutation(readRepositorySnapshot(dir), fakeGrant)
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

test('classifyExternalEffect does NOT count pre-existing dirty files as execution success', () => {
  const grant = { authorization: { allowed_effects: ['local-file-write'], protected_effects: [] } }
  const readback = {
    changedFiles: ['pre.txt'],
    executionProducedChanges: [],
    preExistingDirty: ['pre.txt'],
    scopeViolations: [],
    testResult: { passed: false, output: '' },
    gitStatus: 'modified',
  }
  const outcome = classifyExternalEffect(readback, grant)
  assert.equal(outcome.status, 'failure')
})

test('classifyExternalEffect succeeds when THIS execution produced changes', () => {
  const grant = { authorization: { allowed_effects: ['local-file-write'], protected_effects: [] } }
  const readback = {
    changedFiles: ['post.txt'],
    executionProducedChanges: ['post.txt'],
    preExistingDirty: [],
    scopeViolations: [],
    testResult: { passed: false, output: '' },
    gitStatus: 'modified',
  }
  const outcome = classifyExternalEffect(readback, grant)
  assert.equal(outcome.status, 'success')
})

test('classifyExternalEffect fails on scope violations', () => {
  const grant = { authorization: { allowed_effects: ['local-file-write'], protected_effects: [] } }
  const readback = {
    changedFiles: ['evil.txt'],
    executionProducedChanges: ['evil.txt'],
    preExistingDirty: [],
    scopeViolations: ['evil.txt'],
    testResult: { passed: false, output: '' },
    gitStatus: 'modified',
  }
  const outcome = classifyExternalEffect(readback, grant)
  assert.equal(outcome.status, 'failure')
})
