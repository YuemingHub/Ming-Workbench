import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readRepositorySnapshot } from '../.tmp/execution/repository.js'
import { issueProviderExecutionGrant } from '../.tmp/execution/grant-issuance.js'
import { runBoundedExecution } from '../.tmp/execution/bounded-execution.js'
import { buildExactSlice } from '../.tmp/execution/mutation-slice.js'

/**
 * P0-B: prove the full Intake -> Authorize -> Execute -> Evidence chain on an
 * ephemeral scratch Git repo with a REAL mutation. The grant is issued
 * server-side by `issueProviderExecutionGrant` (the human authorization is the
 * only source of authority — no raw grant JSON from the caller). The real
 * reviewed Harness is replaced by an injected harness-run double that performs
 * the actual file change, because the reviewed bundle + network are CI-owned.
 */

function makeScratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'mw-p0b-'))
  execFileSync('git', ['-C', dir, 'init', '-q'])
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@example.com'])
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'tester'])
  // Seed commit establishes a real HEAD for the granted base_ref.
  writeFileSync(join(dir, 'seed.txt'), 'seed')
  execFileSync('git', ['-C', dir, 'add', '.'])
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'init'])
  // A buggy source + a failing test (the bug to fix).
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

function makeWorkUnit(id = 'WU-P0B') {
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

test('full chain fixes a failing test with real git delta and evidence-backed success', async () => {
  const dir = makeScratchRepo()
  try {
    const workUnit = makeWorkUnit()
    const snapshot = readRepositorySnapshot(dir)
    // Authorize server-side: grant + binding are issued, never supplied by caller.
    // P0-1: the human-confirmed exact file surface freezes the mutation slice.
    const slice = buildExactSlice(dir, snapshot.head, ['answer.mjs'])
    const { grant, binding } = issueProviderExecutionGrant({ workUnit, projectRoot: dir, snapshot, slice })
    assert.ok(grant.authorization.write_target.base_ref)

    // Harness-run double: performs the REAL mutation the grant authorizes.
    const fakeHarness = async (opts) => {
      writeFileSync(join(opts.cwd, 'answer.mjs'), 'export function answer() { return 42 }\n')
      return { sessionId: 'fake-session', stopReason: 'stop', assistantText: 'fixed answer' }
    }

    const result = await runBoundedExecution({
      workUnit,
      grant,
      binding,
      slice,
      projectRoot: dir,
      harnessCheckout: dir, // unused by the double
      workbenchRoot: dir, // unused by the double
      testCommand: ['node', '--test', 'answer.test.mjs'],
      // Operator enabled write mutation for this chain exercise.
      allowWrite: true,
      dependencies: { runHarnessAcpGrant: fakeHarness },
    })

    // Success is decided by real repository evidence, not Harness chatter:
    // mutation observed AND verification passed; acceptance stays pending.
    assert.equal(result.runOutcome.effect, 'mutation-observed')
    assert.equal(result.runOutcome.verification, 'passed')
    assert.equal(result.runOutcome.acceptance, 'pending')
    assert.ok(result.repositoryReadback.executionProducedChanges.includes('answer.mjs'))
    assert.equal(result.repositoryReadback.scopeViolations.length, 0)
    // The Work Unit advanced and carries delta + test evidence.
    assert.equal(result.workUnit.state, 'verifying')
    assert.ok(result.workUnit.evidence.some((e) => e.kind === 'repository'))
    assert.ok(result.workUnit.evidence.some((e) => e.kind === 'test'))
    // The fix is actually on disk and the test now passes.
    assert.match(readRepositorySnapshot(dir).dirtyFiles.join(','), /answer\.mjs/)
  } finally {
    cleanup(dir)
  }
})

test('chain reports failure when the harness produces no in-scope change', async () => {
  const dir = makeScratchRepo()
  const outside = mkdtempSync(join(tmpdir(), 'mw-p0b-out-'))
  try {
    const workUnit = makeWorkUnit('WU-P0B2')
    const snapshot = readRepositorySnapshot(dir)
    const slice = buildExactSlice(dir, snapshot.head, ['answer.mjs'])
    const { grant, binding } = issueProviderExecutionGrant({ workUnit, projectRoot: dir, snapshot, slice })

    // Rogue double: writes outside the granted repo and reports "activity".
    const rogueHarness = async (opts) => {
      writeFileSync(join(outside, 'evil.mjs'), 'export const x = 1\n')
      return { sessionId: 'rogue', stopReason: 'stop', assistantText: 'escaped' }
    }

    const result = await runBoundedExecution({
      workUnit,
      grant,
      binding,
      slice,
      projectRoot: dir,
      harnessCheckout: dir,
      workbenchRoot: dir,
      // Operator enabled write mutation; this test checks scope enforcement, not the gate.
      allowWrite: true,
      dependencies: { runHarnessAcpGrant: rogueHarness },
    })

    // A harness that changes nothing inside the granted scope is NOT success.
    assert.equal(result.runOutcome.effect, 'no-mutation')
    assert.equal(result.runOutcome.verification, 'failed')
    assert.equal(result.repositoryReadback.executionProducedChanges.length, 0)
  } finally {
    cleanup(dir)
    cleanup(outside)
  }
})

/**
 * P0-C: the write boundary is OFF by default. A write-authorized grant must NOT
 * mutate the project unless the operator explicitly enables it (allowWrite=true).
 * This is the safety rail that keeps bounded mutation disabled in the normal UI
 * when an OS-level write sandbox (e.g. the reviewed Harness sandbox) cannot be
 * guaranteed. The harness double is never reached when the gate holds.
 */
test('P0-C write boundary blocks a write-authorized grant unless explicitly enabled', async () => {
  const dir = makeScratchRepo()
  let harnessInvoked = false
  try {
    const workUnit = makeWorkUnit('WU-P0C')
    const snapshot = readRepositorySnapshot(dir)
    const slice = buildExactSlice(dir, snapshot.head, ['answer.mjs'])
    const { grant, binding } = issueProviderExecutionGrant({ workUnit, projectRoot: dir, snapshot, slice })

    assert.equal(grant.authorization.mutation_boundary, 'write-authorized')

    const gatedHarness = async () => {
      harnessInvoked = true
      return { sessionId: 'gated', stopReason: 'stop', assistantText: 'should not run' }
    }

    // Default (allowWrite omitted): execution must be refused before any mutation.
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
          dependencies: { runHarnessAcpGrant: gatedHarness },
        }),
      /Bounded write execution is disabled/,
    )
    assert.equal(harnessInvoked, false, 'harness must not run when the gate holds')
    // The guarded repo is untouched.
    assert.equal(readRepositorySnapshot(dir).dirtyFiles.length, 0)

    // Explicit opt-in: the same grant now executes and the harness double mutates.
    const fakeHarness = async (opts) => {
      writeFileSync(join(opts.cwd, 'answer.mjs'), 'export function answer() { return 42 }\n')
      return { sessionId: 'enabled', stopReason: 'stop', assistantText: 'fixed answer' }
    }
    const ok = await runBoundedExecution({
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
    assert.equal(ok.runOutcome.effect, 'mutation-observed')
    assert.equal(ok.runOutcome.verification, 'passed')
    assert.ok(ok.repositoryReadback.executionProducedChanges.includes('answer.mjs'))
  } finally {
    cleanup(dir)
  }
})

/**
 * P0-2 regression A (real chain): tests green BEFORE execution + agent no-op +
 * tests still green AFTER must NOT be judged task success. The Work Unit goes
 * back to the human (needs-human), never to verifying.
 */
test('P0-2 A: pre-green no-op run is not task success', async () => {
  const dir = makeScratchRepo()
  try {
    // Make the project ALREADY green before execution (committed, clean tree).
    writeFileSync(join(dir, 'answer.mjs'), 'export function answer() { return 42 }\n')
    execFileSync('git', ['-C', dir, 'add', 'answer.mjs'])
    execFileSync('git', ['-C', dir, 'commit', '-qm', 'already green'])
    const workUnit = makeWorkUnit('WU-P02A')
    const snapshot = readRepositorySnapshot(dir)
    const slice = buildExactSlice(dir, snapshot.head, ['answer.mjs'])
    const { grant, binding } = issueProviderExecutionGrant({ workUnit, projectRoot: dir, snapshot, slice })

    // Harness session completes but changes nothing.
    const noopHarness = async () => {
      return { sessionId: 'noop', stopReason: 'end_turn', assistantText: 'nothing to do' }
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
      dependencies: { runHarnessAcpGrant: noopHarness },
    })

    // The four axes say it clearly: nothing was produced and nothing new
    // could be verified — this is NOT success.
    assert.equal(result.runOutcome.effect, 'no-mutation')
    assert.equal(result.runOutcome.verification, 'inconclusive')
    assert.equal(result.runOutcome.acceptance, 'pending')
    assert.equal(result.repositoryReadback.beforeTestResult.passed, true)
    assert.equal(result.workUnit.state, 'needs-human')
  } finally {
    cleanup(dir)
  }
})

/**
 * P0-2 regression B (real chain): agent mutates files but tests FAIL. The old
 * `producedChange || testsPassed` rule wrongly called this success; the four
 * axes call it verification failed / acceptance rejected.
 */
test('P0-2 B: mutation with failing tests is verification failure, not success', async () => {
  const dir = makeScratchRepo()
  try {
    const workUnit = makeWorkUnit('WU-P02B')
    const snapshot = readRepositorySnapshot(dir)
    const slice = buildExactSlice(dir, snapshot.head, ['answer.mjs'])
    const { grant, binding } = issueProviderExecutionGrant({ workUnit, projectRoot: dir, snapshot, slice })

    // Harness changes the file but leaves the test failing.
    const badHarness = async (opts) => {
      writeFileSync(join(opts.cwd, 'answer.mjs'), 'export function answer() { return 40 }\n')
      return { sessionId: 'bad', stopReason: 'end_turn', assistantText: 'changed it' }
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
      dependencies: { runHarnessAcpGrant: badHarness },
    })

    assert.equal(result.runOutcome.effect, 'mutation-observed')
    assert.equal(result.runOutcome.verification, 'failed')
    assert.equal(result.runOutcome.acceptance, 'rejected')
    assert.ok(result.repositoryReadback.executionProducedChanges.includes('answer.mjs'))
    assert.equal(result.workUnit.state, 'blocked')
  } finally {
    cleanup(dir)
  }
})
