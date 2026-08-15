import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readRepositorySnapshot } from '../.tmp/execution/repository.js'
import { issueProviderExecutionGrant } from '../.tmp/execution/grant-issuance.js'
import { runBoundedExecution } from '../.tmp/execution/bounded-execution.js'
import {
  buildExactSlice,
  buildWholeRepositorySlice,
  buildUnknownSlice,
  assertSliceAllowsWrite,
  isPathWithinSlice,
  normalizeSlicePath,
} from '../.tmp/execution/mutation-slice.js'

/**
 * P0-1: the mutation boundary is a real MutationSlice, never a project-root
 * string disguised as an intended file.
 *
 *   paths unknown        -> read-only intake allowed, write authorization refused
 *   paths known          -> fresh frontier check -> exact human authorization
 *                           -> frozen paths -> execution -> after-delta is a
 *                           subset of the authorized paths
 *   whole-repository     -> explicit separate scope, explicit behavior
 *
 * Every scenario runs the REAL authorize -> execute chain on an ephemeral
 * scratch Git repository with a REAL file mutation (the only fake is the
 * Harness session, replaced by an injected double that performs the mutation).
 */

function makeScratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'mw-slice-'))
  execFileSync('git', ['-C', dir, 'init', '-q'])
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@example.com'])
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'tester'])
  writeFileSync(join(dir, 'seed.txt'), 'seed')
  execFileSync('git', ['-C', dir, 'add', '.'])
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'init'])
  // Buggy source + failing test (the bug to fix), plus an unrelated file.
  writeFileSync(join(dir, 'answer.mjs'), 'export function answer() { return 41 }\n')
  writeFileSync(join(dir, 'other.mjs'), 'export const other = "untouched"\n')
  writeFileSync(
    join(dir, 'answer.test.mjs'),
    "import test from 'node:test'\n" +
      "import assert from 'node:assert/strict'\n" +
      "import { answer } from './answer.mjs'\n" +
      "test('answer is 42', () => { assert.equal(answer(), 42) })\n",
  )
  execFileSync('git', ['-C', dir, 'add', '.'])
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'baseline'])
  return dir
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

function makeWorkUnit(id = 'WU-SLICE') {
  return {
    id,
    spaceId: 'SPACE-x',
    title: 'fix the answer',
    outcome: 'make the answer test pass',
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

/** Harness double: writes a REAL file inside the scratch repo. */
function mutatingHarness(file, content = 'export function answer() { return 42 }\n') {
  return async (opts) => {
    writeFileSync(join(opts.cwd, file), content)
    return { sessionId: `session-${file}`, stopReason: 'stop', assistantText: 'done' }
  }
}

// ===========================================================================
// Scenario 1: unknown path surface -> write blocked (unit + chain level)
// ===========================================================================

test('P0-1 scenario 1: unknown slice refuses write authorization at grant issuance', () => {
  const dir = makeScratchRepo()
  try {
    const snapshot = readRepositorySnapshot(dir)
    const slice = buildUnknownSlice(dir, snapshot.head)
    assert.throws(
      () =>
        issueProviderExecutionGrant({
          workUnit: makeWorkUnit(),
          projectRoot: dir,
          snapshot,
          slice,
        }),
      /write authorization requires a known file surface/,
    )
    // Fail-closed helper agrees at every layer.
    assert.throws(() => assertSliceAllowsWrite(slice), /known file surface/)
  } finally {
    cleanup(dir)
  }
})

test('P0-1 scenario 1 (chain): unknown slice blocks execution before any harness session', async () => {
  const dir = makeScratchRepo()
  let harnessInvoked = false
  try {
    const workUnit = makeWorkUnit('WU-SLICE-UNKNOWN')
    const snapshot = readRepositorySnapshot(dir)
    const slice = buildUnknownSlice(dir, snapshot.head)
    const { grant, binding } = issueProviderExecutionGrant({
      workUnit,
      projectRoot: dir,
      snapshot,
      slice: buildExactSlice(dir, snapshot.head, ['answer.mjs']),
    })
    await assert.rejects(
      () =>
        runBoundedExecution({
          workUnit,
          grant,
          binding,
          slice,
          projectRoot: dir,
          harnessCheckout: dir,
          workbenchRoot: dir,
          allowWrite: true,
          dependencies: {
            runHarnessAcpGrant: async () => {
              harnessInvoked = true
              return { sessionId: 'x', stopReason: 'stop', assistantText: '' }
            },
          },
        }),
      /known file surface/,
    )
    assert.equal(harnessInvoked, false, 'harness must never run on an unknown surface')
    assert.equal(readRepositorySnapshot(dir).dirtyFiles.length, 0)
  } finally {
    cleanup(dir)
  }
})

// ===========================================================================
// Scenario 2: exact authorized file mutation -> allowed
// ===========================================================================

test('P0-1 scenario 2: exact authorized mutation succeeds and delta is a subset of the slice', async () => {
  const dir = makeScratchRepo()
  try {
    const workUnit = makeWorkUnit('WU-SLICE-EXACT')
    const snapshot = readRepositorySnapshot(dir)
    const slice = buildExactSlice(dir, snapshot.head, ['answer.mjs'])
    const { grant, binding } = issueProviderExecutionGrant({ workUnit, projectRoot: dir, snapshot, slice })

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
      dependencies: { runHarnessAcpGrant: mutatingHarness('answer.mjs') },
    })

    assert.equal(result.runOutcome.effect, 'mutation-observed')
    assert.equal(result.runOutcome.verification, 'passed')
    assert.deepEqual(result.repositoryReadback.executionProducedChanges, ['answer.mjs'])
    assert.equal(result.repositoryReadback.scopeViolations.length, 0)
    // The after-execution delta is exactly the authorized surface.
    for (const file of result.repositoryReadback.changedFiles) {
      assert.ok(isPathWithinSlice(slice, file), `delta file ${file} is outside the slice`)
    }
  } finally {
    cleanup(dir)
  }
})

// ===========================================================================
// Scenario 3: mutation outside authorized files -> hard failure
// ===========================================================================

test('P0-1 scenario 3: mutation outside the authorized files is a hard failure', async () => {
  const dir = makeScratchRepo()
  try {
    const workUnit = makeWorkUnit('WU-SLICE-OUTSIDE')
    const snapshot = readRepositorySnapshot(dir)
    const slice = buildExactSlice(dir, snapshot.head, ['answer.mjs'])
    const { grant, binding } = issueProviderExecutionGrant({ workUnit, projectRoot: dir, snapshot, slice })

    // The harness changes answer.mjs (in scope) AND other.mjs (out of scope).
    const rogueHarness = async (opts) => {
      writeFileSync(join(opts.cwd, 'answer.mjs'), 'export function answer() { return 42 }\n')
      writeFileSync(join(opts.cwd, 'other.mjs'), 'export const other = "hijacked"\n')
      return { sessionId: 'rogue', stopReason: 'stop', assistantText: 'did more than authorized' }
    }

    const result = await runBoundedExecution({
      workUnit,
      grant,
      binding,
      slice,
      projectRoot: dir,
      harnessCheckout: dir,
      workbenchRoot: dir,
      allowWrite: true,
      dependencies: { runHarnessAcpGrant: rogueHarness },
    })

    // Hard failure: scope violations are never success, regardless of tests.
    assert.equal(result.runOutcome.verification, 'failed')
    assert.equal(result.runOutcome.acceptance, 'rejected')
    assert.ok(result.repositoryReadback.scopeViolations.includes('other.mjs'))
    assert.match(result.runOutcome.reason, /outside the granted scope/)
    // The Work Unit must not advance to verifying.
    assert.equal(result.workUnit.state, 'blocked')
  } finally {
    cleanup(dir)
  }
})

// ===========================================================================
// Scenario 4: pre-existing dirty file overlaps the slice -> blocked
// ===========================================================================

test('P0-1 scenario 4: pre-existing dirty file overlapping the slice blocks execution', async () => {
  const dir = makeScratchRepo()
  let harnessInvoked = false
  try {
    const workUnit = makeWorkUnit('WU-SLICE-OVERLAP')
    const snapshot = readRepositorySnapshot(dir)
    const slice = buildExactSlice(dir, snapshot.head, ['answer.mjs'])
    const { grant, binding } = issueProviderExecutionGrant({ workUnit, projectRoot: dir, snapshot, slice })

    // Human work is already sitting on the authorized file before execution.
    writeFileSync(join(dir, 'answer.mjs'), 'export function answer() { return 41 }\n// human in progress\n')

    await assert.rejects(
      () =>
        runBoundedExecution({
          workUnit,
          grant,
          binding,
          slice,
          projectRoot: dir,
          harnessCheckout: dir,
          workbenchRoot: dir,
          allowWrite: true,
          dependencies: {
            runHarnessAcpGrant: async () => {
              harnessInvoked = true
              return { sessionId: 'x', stopReason: 'stop', assistantText: '' }
            },
          },
        }),
      /blocked by repository frontier/,
    )
    assert.equal(harnessInvoked, false, 'harness must not run when the slice overlaps dirty work')
  } finally {
    cleanup(dir)
  }
})

// ===========================================================================
// Scenario 5: pre-existing dirty file OUTSIDE the slice -> allowed
// ===========================================================================

test('P0-1 scenario 5: pre-existing dirty file outside the slice does not block execution', async () => {
  const dir = makeScratchRepo()
  try {
    const workUnit = makeWorkUnit('WU-SLICE-NOOVERLAP')
    const snapshot = readRepositorySnapshot(dir)
    const slice = buildExactSlice(dir, snapshot.head, ['answer.mjs'])
    const { grant, binding } = issueProviderExecutionGrant({ workUnit, projectRoot: dir, snapshot, slice })

    // Unrelated human work on a different file.
    writeFileSync(join(dir, 'notes.txt'), 'human notes, not part of this execution\n')

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
      dependencies: { runHarnessAcpGrant: mutatingHarness('answer.mjs') },
    })

    assert.equal(result.runOutcome.effect, 'mutation-observed')
    assert.equal(result.runOutcome.verification, 'passed')
    // The dirty file outside the slice is never counted as execution success.
    assert.ok(result.repositoryReadback.preExistingDirty.includes('notes.txt'))
    assert.deepEqual(result.repositoryReadback.executionProducedChanges, ['answer.mjs'])
  } finally {
    cleanup(dir)
  }
})

// ===========================================================================
// Scenario 6: whole-repository scope is explicit, separate, and strict
// ===========================================================================

test('P0-1 scenario 6a: whole-repository scope is an explicit slice kind, never a default', () => {
  const dir = makeScratchRepo()
  try {
    const snapshot = readRepositorySnapshot(dir)
    const slice = buildWholeRepositorySlice(dir, snapshot.head)
    assert.equal(slice.scope.kind, 'whole-repository')
    // Every repo-relative path is inside a whole-repository slice (repo-root
    // containment is still enforced separately by computeExecutionDelta).
    assert.ok(isPathWithinSlice(slice, 'answer.mjs'))
    assert.ok(isPathWithinSlice(slice, 'deep/dir/file.txt'))
    assert.doesNotThrow(() => assertSliceAllowsWrite(slice))
    const { grant } = issueProviderExecutionGrant({
      workUnit: makeWorkUnit('WU-SLICE-WHOLE1'),
      projectRoot: dir,
      snapshot,
      slice,
    })
    assert.match(grant.acceptance_evidence[0], /whole-repository/)
  } finally {
    cleanup(dir)
  }
})

test('P0-1 scenario 6b: whole-repository execution allows any in-repo mutation', async () => {
  const dir = makeScratchRepo()
  try {
    const workUnit = makeWorkUnit('WU-SLICE-WHOLE2')
    const snapshot = readRepositorySnapshot(dir)
    const slice = buildWholeRepositorySlice(dir, snapshot.head)
    const { grant, binding } = issueProviderExecutionGrant({ workUnit, projectRoot: dir, snapshot, slice })

    // Whole-repo scope: mutate an unrelated file AND the buggy source.
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
      dependencies: {
        runHarnessAcpGrant: async (opts) => {
          writeFileSync(join(opts.cwd, 'other.mjs'), 'export const other = "whole-repo"\n')
          writeFileSync(join(opts.cwd, 'answer.mjs'), 'export function answer() { return 42 }\n')
          return { sessionId: 'whole', stopReason: 'stop', assistantText: 'done' }
        },
      },
    })

    // Any in-repo mutation is within a whole-repository slice.
    assert.equal(result.runOutcome.effect, 'mutation-observed')
    assert.equal(result.runOutcome.verification, 'passed')
    assert.deepEqual(result.repositoryReadback.executionProducedChanges.sort(), ['answer.mjs', 'other.mjs'])
    assert.equal(result.repositoryReadback.scopeViolations.length, 0)
  } finally {
    cleanup(dir)
  }
})

test('P0-1 scenario 6c: whole-repository scope requires a clean working tree', async () => {
  const dir = makeScratchRepo()
  let harnessInvoked = false
  try {
    const workUnit = makeWorkUnit('WU-SLICE-WHOLE3')
    const snapshot = readRepositorySnapshot(dir)
    const slice = buildWholeRepositorySlice(dir, snapshot.head)
    const { grant, binding } = issueProviderExecutionGrant({ workUnit, projectRoot: dir, snapshot, slice })

    // Any uncommitted work conflicts with an explicit whole-repository scope.
    writeFileSync(join(dir, 'dirty.txt'), 'uncommitted')

    await assert.rejects(
      () =>
        runBoundedExecution({
          workUnit,
          grant,
          binding,
          slice,
          projectRoot: dir,
          harnessCheckout: dir,
          workbenchRoot: dir,
          allowWrite: true,
          dependencies: {
            runHarnessAcpGrant: async () => {
              harnessInvoked = true
              return { sessionId: 'x', stopReason: 'stop', assistantText: '' }
            },
          },
        }),
      /blocked by repository frontier/,
    )
    assert.equal(harnessInvoked, false)
  } finally {
    cleanup(dir)
  }
})

// ===========================================================================
// Path hygiene
// ===========================================================================

test('P0-1 slice paths are normalized and cannot escape the repository', () => {
  assert.equal(normalizeSlicePath('./src\\app.mjs'), 'src/app.mjs')
  assert.equal(normalizeSlicePath('a\\b\\c'), 'a/b/c')
  assert.throws(() => buildExactSlice('C:/repo', 'HEAD', ['../escape.mjs']), /escapes the repository/)
  assert.throws(() => buildExactSlice('C:/repo', 'HEAD', ['C:/abs.mjs']), /escapes the repository/)
  assert.throws(() => buildExactSlice('C:/repo', 'HEAD', ['/abs.mjs']), /escapes the repository/)
  assert.throws(() => buildExactSlice('C:/repo', 'HEAD', ['a/../../escape.mjs']), /escapes the repository/)
  assert.throws(() => buildExactSlice('C:/repo', 'HEAD', []), /at least one path/)
  const slice = buildExactSlice('C:/repo', 'HEAD', ['src/app.mjs', 'src/app.mjs', 'lib/util.ts'])
  assert.deepEqual(slice.scope.paths, ['lib/util.ts', 'src/app.mjs'])
  // Directory entries cover their subtree.
  const dirSlice = buildExactSlice('C:/repo', 'HEAD', ['src'])
  assert.ok(isPathWithinSlice(dirSlice, 'src/app.mjs'))
  assert.ok(!isPathWithinSlice(dirSlice, 'lib/util.ts'))
})
