import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readRepositorySnapshot } from '../.tmp/execution/repository.js'
import { issueProviderExecutionGrant } from '../.tmp/execution/grant-issuance.js'
import { runBoundedExecution } from '../.tmp/execution/bounded-execution.js'
import { buildExactSlice } from '../.tmp/execution/mutation-slice.js'
import {
  createExecutionIsolation,
  discardExecutionIsolation,
  readIsolationBaseline,
  computeIsolatedDelta,
  applyAuthorizedDelta,
} from '../.tmp/execution/execution-isolation.js'

/**
 * P0-1 (re-opened): execution-time isolation. The real repository must never be
 * the Harness mutation target. A disposable worktree absorbs the whole run;
 * only the authorized + verified delta is applied back. An adversarial Harness
 * that mutates outside the granted slice must never contaminate the Reality
 * Owner's worktree — the isolation is discarded and the real repo stays byte
 * for byte unchanged.
 */

function makeScratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'mw-iso-'))
  execFileSync('git', ['-C', dir, 'init', '-q'])
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@example.com'])
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'tester'])
  writeFileSync(join(dir, 'seed.txt'), 'seed')
  execFileSync('git', ['-C', dir, 'add', '.'])
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'init'])
  writeFileSync(join(dir, 'answer.mjs'), 'export function answer() { return 41 }\n')
  writeFileSync(
    join(dir, 'answer.test.mjs'),
    "import test from 'node:test'\n" +
      "import assert from 'node:assert/strict'\n" +
      "import { answer } from './answer.mjs'\n" +
      "test('answer is 42', () => { assert.equal(answer(), 42) })\n",
  )
  execFileSync('git', ['-C', dir, 'add', '.'])
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'bug: answer is wrong'])
  return dir
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

function makeWorkUnit(id = 'WU-ISO') {
  return {
    id,
    spaceId: 'SPACE-x',
    title: 'fix the test',
    outcome: 'fix the failing answer test',
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

test('adversarial: Harness mutates authorized A + unauthorized B; B never contaminates the real repo', async () => {
  const dir = makeScratchRepo()
  const realHead = readRepositorySnapshot(dir).head
  const realTree = readRepositorySnapshot(dir)
  try {
    const workUnit = makeWorkUnit()
    const snapshot = readRepositorySnapshot(dir)
    // Human authorizes ONLY answer.mjs.
    const slice = buildExactSlice(dir, snapshot.head, ['answer.mjs'])
    const { grant, binding } = issueProviderExecutionGrant({ workUnit, projectRoot: dir, snapshot, slice })

    // Rogue Harness: changes the authorized file AND deliberately mutates a
    // file outside the grant (answer.test.mjs) inside what it believes is the
    // project. In the isolated design this lands in the disposable worktree.
    const rogueHarness = async (opts) => {
      writeFileSync(join(opts.cwd, 'answer.mjs'), 'export function answer() { return 42 }\n')
      writeFileSync(join(opts.cwd, 'answer.test.mjs'), 'export const tampered = true\n')
      return { sessionId: 'rogue', stopReason: 'stop', assistantText: 'changed A and B' }
    }

    const result = await runBoundedExecution({
      workUnit,
      grant,
      binding,
      slice,
      projectRoot: dir,
      harnessCheckout: dir,
      workbenchRoot: dir,
      testCommand: ['node', '--test', 'answer.test.mjs'],
      allowWrite: true,
      dependencies: { runHarnessAcpGrant: rogueHarness },
    })

    // 1. The unauthorized change is detected as a scope violation.
    assert.deepEqual(result.repositoryReadback.scopeViolations, ['answer.test.mjs'])
    // 2. Even the authorized change is never applied back: a boundary violation
    //    discards the whole isolation. The real repo must stay untouched.
    assert.deepEqual(result.appliedBack, [])
    assert.equal(result.repositoryReadback.isolationDiscarded, true)
    // 3. Four-axis outcome: boundary failure is verification failed + rejected.
    assert.equal(result.runOutcome.verification, 'failed')
    assert.equal(result.runOutcome.acceptance, 'rejected')
    // 4. The REAL repository is byte-for-byte unchanged.
    const realAfter = readRepositorySnapshot(dir)
    assert.deepEqual(realAfter.dirtyFiles, [])
    assert.equal(realAfter.head, realHead)
    assert.equal(realAfter.head, realTree.head)
    // 5. The isolation worktree was removed on every path.
    assert.equal(existsSync(result.isolation.worktree), false)
  } finally {
    cleanup(dir)
  }
})

test('normal path: isolated execution, authorized delta only, tests pass, apply-back, real repo readback', async () => {
  const dir = makeScratchRepo()
  const realHead = readRepositorySnapshot(dir).head
  try {
    const workUnit = makeWorkUnit()
    const snapshot = readRepositorySnapshot(dir)
    const slice = buildExactSlice(dir, snapshot.head, ['answer.mjs'])
    const { grant, binding } = issueProviderExecutionGrant({ workUnit, projectRoot: dir, snapshot, slice })

    // Harness double performs the REAL mutation inside the isolation.
    const fakeHarness = async (opts) => {
      writeFileSync(join(opts.cwd, 'answer.mjs'), 'export function answer() { return 42 }\n')
      return { sessionId: 'normal', stopReason: 'stop', assistantText: 'fixed answer' }
    }

    const result = await runBoundedExecution({
      workUnit,
      grant,
      binding,
      slice,
      projectRoot: dir,
      harnessCheckout: dir,
      workbenchRoot: dir,
      testCommand: ['node', '--test', 'answer.test.mjs'],
      allowWrite: true,
      dependencies: { runHarnessAcpGrant: fakeHarness },
    })

    // The real repo was never the harness cwd; execution happened in isolation.
    assert.equal(result.repositoryReadback.isolated, true)
    assert.equal(result.repositoryReadback.isolationDiscarded, false)
    // Only the authorized delta was applied back.
    assert.deepEqual(result.appliedBack, ['answer.mjs'])
    assert.equal(result.runOutcome.verification, 'passed')
    assert.equal(result.runOutcome.acceptance, 'pending')
    // Authoritative readback: the real repo now carries exactly the authorized change.
    const realAfter = readRepositorySnapshot(dir)
    assert.deepEqual(realAfter.dirtyFiles, ['answer.mjs'])
    assert.equal(realAfter.head, realHead)
    // Harness session completion is never Work Unit completion.
    assert.equal(result.workUnit.state, 'verifying')
    assert.notEqual(result.workUnit.state, 'completed')
    // Isolation cleaned up.
    assert.equal(existsSync(result.isolation.worktree), false)
  } finally {
    cleanup(dir)
  }
})

test('isolation primitives: create/compute/apply/discard lifecycle', () => {
  const dir = makeScratchRepo()
  const isolationRoot = mkdtempSync(join(tmpdir(), 'mw-iso-root-'))
  try {
    const snapshot = readRepositorySnapshot(dir)
    const iso = createExecutionIsolation({
      repository: dir,
      baseRef: snapshot.head,
      isolationRoot,
    })
    assert.ok(iso.worktree.startsWith(isolationRoot), 'worktree lives under the isolation root')
    const baseline = readIsolationBaseline(iso)
    assert.deepEqual(baseline.dirtyFiles, [])
    assert.equal(baseline.head, snapshot.head)
    assert.equal(baseline.isGit, true)

    // Real repo stays clean while the worktree is mutated.
    writeFileSync(join(iso.worktree, 'new-file.mjs'), 'export const x = 1\n')
    const slice = buildExactSlice(dir, snapshot.head, ['new-file.mjs'])
    const delta = computeIsolatedDelta(iso, slice, baseline)
    assert.deepEqual(delta.executionProducedChanges, ['new-file.mjs'])
    assert.deepEqual(delta.scopeViolations, [])
    assert.deepEqual(readRepositorySnapshot(dir).dirtyFiles, [], 'real repo untouched before apply')

    const applied = applyAuthorizedDelta(iso, slice, delta.executionProducedChanges)
    assert.deepEqual(applied, ['new-file.mjs'])
    assert.deepEqual(readRepositorySnapshot(dir).dirtyFiles, ['new-file.mjs'])

    discardExecutionIsolation(iso)
    assert.equal(existsSync(iso.worktree), false)
    // The real repo keeps the applied change after the worktree is gone.
    assert.deepEqual(readRepositorySnapshot(dir).dirtyFiles, ['new-file.mjs'])
  } finally {
    cleanup(dir)
  }
})

test('isolation refuses a stale base ref (real HEAD drifted from the grant)', () => {
  const dir = makeScratchRepo()
  try {
    const snapshot = readRepositorySnapshot(dir)
    // Simulate a stale authority: HEAD moves after the grant was issued.
    writeFileSync(join(dir, 'later.txt'), 'later')
    execFileSync('git', ['-C', dir, 'add', '.'])
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'later'])
    assert.throws(
      () =>
        createExecutionIsolation({
          repository: dir,
          baseRef: snapshot.head,
        }),
      /match the granted base ref/,
    )
  } finally {
    cleanup(dir)
  }
})
