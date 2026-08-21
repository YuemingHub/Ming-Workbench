import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync, rmSync, symlinkSync, readFileSync } from 'node:fs'
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
  resolveIsolationPath,
  isInsideIsolation,
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

/**
 * A. Git metadata isolation adversarial. The isolation is a fully independent
 * clone, NOT a linked worktree: `git branch`, `git update-ref`, `git tag`,
 * `git config`, `git commit` executed inside the isolation must never change
 * the real repository's refs / HEAD / config / tags / working tree.
 */
test('A: git metadata mutation inside the isolation never touches the real repository', async () => {
  const dir = makeScratchRepo()
  try {
    const snapshot = readRepositorySnapshot(dir)
    const realHead = snapshot.head
    const iso = createExecutionIsolation({ repository: dir, baseRef: realHead })

    // Deliberate git metadata attacks inside the isolation.
    execFileSync('git', ['-C', iso.worktree, 'branch', 'evil-branch'])
    execFileSync('git', ['-C', iso.worktree, 'update-ref', 'refs/tags/evil-tag', realHead])
    execFileSync('git', ['-C', iso.worktree, 'config', 'user.name', 'hacked'])
    writeFileSync(join(iso.worktree, 'evil.txt'), 'evil')
    execFileSync('git', ['-C', iso.worktree, 'add', '.'])
    execFileSync('git', ['-C', iso.worktree, '-c', 'user.name=t', '-c', 'user.email=t@e.c', 'commit', '-qm', 'attack commit'])

    // The real repository's metadata is completely unchanged.
    const realBranches = execFileSync('git', ['-C', dir, 'branch'], { encoding: 'utf8' })
    assert.equal(realBranches.includes('evil-branch'), false, 'real repo must not gain the evil branch')
    const realTags = execFileSync('git', ['-C', dir, 'tag'], { encoding: 'utf8' })
    assert.equal(realTags.includes('evil-tag'), false, 'real repo must not gain the evil tag')
    const realUser = execFileSync('git', ['-C', dir, 'config', '--get', 'user.name'], { encoding: 'utf8' }).trim()
    assert.equal(realUser, 'tester', 'real repo config must stay untouched')
    const realAfter = readRepositorySnapshot(dir)
    assert.equal(realAfter.head, realHead, 'real repo HEAD must not move')
    assert.deepEqual(realAfter.dirtyFiles, [], 'real repo working tree must stay clean')

    // The isolation carries its own metadata (proving independence).
    const isoBranches = execFileSync('git', ['-C', iso.worktree, 'branch'], { encoding: 'utf8' })
    assert.equal(isoBranches.includes('evil-branch'), true, 'isolation owns the evil branch privately')
    assert.equal(existsSync(join(iso.worktree, 'evil.txt')), true)

    // Cleanup leaves the real repo with zero git worktree/clone metadata.
    discardExecutionIsolation(iso)
    assert.equal(existsSync(iso.worktree), false, 'isolation directory removed')
    const worktreeList = execFileSync('git', ['-C', dir, 'worktree', 'list'], { encoding: 'utf8' })
    assert.equal(worktreeList.includes(iso.worktree), false, 'no worktree registration residue')
  } finally {
    cleanup(dir)
  }
})

/**
 * B. Symlink / junction escape adversarial. A symlink planted inside the
 * isolation that points at the real repo or an external sentinel must be
 * detected as a scope violation and must never be applied back.
 */
test('B: symlink escape inside the isolation is detected and never applied back', (t) => {
  const dir = makeScratchRepo()
  const sentinel = mkdtempSync(join(tmpdir(), 'mw-iso-sentinel-'))
  try {
    // A sentinel outside the real repo (simulates "external" targets).
    writeFileSync(join(sentinel, 'target.txt'), 'ORIGINAL-SENTINEL')
    const snapshot = readRepositorySnapshot(dir)
    const iso = createExecutionIsolation({ repository: dir, baseRef: snapshot.head })
    const baseline = readIsolationBaseline(iso)

    // Harness plants a symlink pointing at the external sentinel AND one at the
    // real repo's working tree. On hosts without the privilege to create
    // symlinks (Windows without admin/Developer Mode), symlinkSync throws EPERM
    // before any detection code can run — that is an OS capability limit, not a
    // product regression, so we skip with an explicit reason instead of failing.
    try {
      symlinkSync(join(sentinel, 'target.txt'), join(iso.worktree, 'link-external'))
      symlinkSync(join(dir, 'answer.mjs'), join(iso.worktree, 'link-repo'))
    } catch (error) {
      discardExecutionIsolation(iso)
      t.skip(`host cannot create symlinks (${error.code}); symlink-escape detection gate not exercisable here`)
      return
    }

    // The delta verification must flag both as scope violations (fail-closed),
    // regardless of slice membership.
    const slice = buildExactSlice(dir, snapshot.head, ['link-external', 'link-repo'])
    const delta = computeIsolatedDelta(iso, slice, baseline)
    assert.equal(delta.scopeViolations.includes('link-external'), true, 'external symlink flagged')
    assert.equal(delta.scopeViolations.includes('link-repo'), true, 'real-repo symlink flagged')
    assert.deepEqual(delta.executionProducedChanges, [], 'no symlink may be produced')

    // resolveIsolationPath refuses both.
    assert.throws(() => resolveIsolationPath(iso, 'link-external'), /escapes the execution sandbox/)
    assert.throws(() => resolveIsolationPath(iso, 'link-repo'), /escapes the execution sandbox/)
    assert.equal(isInsideIsolation(iso, join(sentinel, 'target.txt')), false)

    // applyAuthorizedDelta refuses to copy a symlink back (fail-closed throw).
    assert.throws(() => applyAuthorizedDelta(iso, slice, ['link-external']), /escapes the execution sandbox/)
    // The sentinel is untouched.
    assert.equal(readFileSync(join(sentinel, 'target.txt'), 'utf8'), 'ORIGINAL-SENTINEL')

    discardExecutionIsolation(iso)
    assert.equal(existsSync(iso.worktree), false)
  } finally {
    cleanup(dir)
    cleanup(sentinel)
  }
})

/**
 * C. Cross-platform cleanup on every path: success, scope violation, harness
 * throw, and test failure must all remove the isolation and leave the real repo
 * clean. Cleanup uses Node rmSync only (no shell rm -rf), which is the same
 * path a Windows packaged run uses.
 */
async function runIsolationPathScenario(harnessImpl) {
  const dir = makeScratchRepo()
  const beforeHead = readRepositorySnapshot(dir).head
  const beforeDirty = readRepositorySnapshot(dir).dirtyFiles
  const workUnit = makeWorkUnit(`WU-ISO-${Math.random().toString(36).slice(2)}`)
  const snapshot = readRepositorySnapshot(dir)
  const slice = buildExactSlice(dir, snapshot.head, ['answer.mjs'])
  const { grant, binding } = issueProviderExecutionGrant({ workUnit, projectRoot: dir, snapshot, slice })
  let result
  let threw = null
  try {
    result = await runBoundedExecution({
      workUnit,
      grant,
      binding,
      slice,
      projectRoot: dir,
      harnessCheckout: dir,
      workbenchRoot: dir,
      testCommand: ['node', '--test', 'answer.test.mjs'],
      allowWrite: true,
      dependencies: { runHarnessAcpGrant: harnessImpl },
    })
  } catch (error) {
    threw = error
  }
  return { dir, beforeHead, beforeDirty, result, threw }
}

test('C1: cleanup on success removes the isolation and leaves the real repo clean', async () => {
  const { dir, beforeHead } = await runIsolationPathScenario(async (opts) => {
    writeFileSync(join(opts.cwd, 'answer.mjs'), 'export function answer() { return 42 }\n')
    return { sessionId: 'c1', stopReason: 'stop', assistantText: 'ok' }
  })
  const after = readRepositorySnapshot(dir)
  assert.deepEqual(after.dirtyFiles, ['answer.mjs'])
  assert.equal(after.head, beforeHead)
  const wtList = execFileSync('git', ['-C', dir, 'worktree', 'list'], { encoding: 'utf8' })
  assert.equal(wtList.includes('mw-isolation'), false, 'no worktree residue')
  cleanup(dir)
})

test('C2: cleanup on scope violation removes the isolation and leaves the real repo untouched', async () => {
  const { dir, beforeHead } = await runIsolationPathScenario(async (opts) => {
    writeFileSync(join(opts.cwd, 'answer.mjs'), 'export function answer() { return 42 }\n')
    writeFileSync(join(opts.cwd, 'answer.test.mjs'), 'export const tampered = true\n')
    return { sessionId: 'c2', stopReason: 'stop', assistantText: 'A+B' }
  })
  const after = readRepositorySnapshot(dir)
  assert.deepEqual(after.dirtyFiles, [], 'real repo untouched on violation')
  assert.equal(after.head, beforeHead)
  const wtList = execFileSync('git', ['-C', dir, 'worktree', 'list'], { encoding: 'utf8' })
  assert.equal(wtList.includes('mw-isolation'), false, 'no worktree residue')
  cleanup(dir)
})

test('C3: cleanup on harness throw removes the isolation and leaves the real repo untouched', async () => {
  const { dir, beforeHead, threw } = await runIsolationPathScenario(async () => {
    throw new Error('harness exploded')
  })
  assert.ok(threw, 'harness throw propagates as a failed run attempt')
  const after = readRepositorySnapshot(dir)
  assert.deepEqual(after.dirtyFiles, [])
  assert.equal(after.head, beforeHead)
  const wtList = execFileSync('git', ['-C', dir, 'worktree', 'list'], { encoding: 'utf8' })
  assert.equal(wtList.includes('mw-isolation'), false, 'no worktree residue')
  cleanup(dir)
})

test('C4: cleanup on test failure removes the isolation and applies nothing back', async () => {
  const { dir, beforeHead } = await runIsolationPathScenario(async (opts) => {
    writeFileSync(join(opts.cwd, 'answer.mjs'), 'export function answer() { return 40 }\n')
    return { sessionId: 'c4', stopReason: 'stop', assistantText: 'broken' }
  })
  const after = readRepositorySnapshot(dir)
  assert.deepEqual(after.dirtyFiles, [], 'failed verification applies nothing back')
  assert.equal(after.head, beforeHead)
  const wtList = execFileSync('git', ['-C', dir, 'worktree', 'list'], { encoding: 'utf8' })
  assert.equal(wtList.includes('mw-isolation'), false, 'no worktree residue')
  cleanup(dir)
})
