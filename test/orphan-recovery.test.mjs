import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  reconcileOrphanedRun,
  reconcileOrphanedRuns,
  NON_TERMINAL_STATUSES,
} from '../.tmp/execution/orphan-recovery.js'
import { buildExactSlice, buildUnknownSlice } from '../.tmp/execution/mutation-slice.js'
import { openExecutionRun, closeExecutionRun } from '../.tmp/execution/execution-run.js'
import {
  fromPersistedExecutionRun,
  toPersistedExecutionRun,
} from '../.tmp/persistence/work-unit-store.js'

/**
 * P1-5: Crash / Orphaned Run Recovery regression matrix.
 *
 * The system must not pretend nothing happened after a crash, and must never
 * blind-retry (UNKNOWN ≠ RETRY). Each crash case re-observes reality and
 * attributes any effect to the ORIGINAL run.
 */

function makeScratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'mw-orphan-'))
  execFileSync('git', ['-C', dir, 'init', '-q'])
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@example.com'])
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'tester'])
  writeFileSync(join(dir, 'app.js'), 'const a = 1\n')
  execFileSync('git', ['-C', dir, 'add', '.'])
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'init'])
  return dir
}

function makeGrant(repository, baseRef = '') {
  const head = baseRef
    ? baseRef
    : (() => {
        try {
          return execFileSync('git', ['-C', repository, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
        } catch {
          return ''
        }
      })()
  return {
    schema_version: '1.0',
    grant_id: 'GRANT-orphan',
    provider: 'deepseek-harness',
    route: 'bug-fix',
    working_contract_revision: 1,
    goal: 'fix',
    baseline: [],
    execution_mode: 'single-agent',
    tasks: [],
    authorization: {
      mutation_boundary: 'write-authorized',
      write_target: { repository, base_ref: head, working_ref: 'main' },
      allowed_effects: ['local-git-mutation'],
      protected_effects: [],
    },
    acceptance_evidence: [],
    human_open_questions: [],
    references: [],
    issued_at: '2026-08-15T00:00:00.000Z',
  }
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

function orphanedRun(workUnitId, opts = {}) {
  const run = openExecutionRun({
    workUnitId,
    authorizationRef: 'GRANT-orphan',
    provider: 'deepseek-harness',
    purpose: opts.purpose,
    now: opts.now,
  })
  // A crash leaves a non-terminal run. 'started' is the open() status; if the
  // caller asks for a mid-flight state, record it via the run status directly.
  if (opts.status === 'running') {
    return { ...run, status: 'running' }
  }
  return run
}

// --- Crash A: run created, no mutation yet ----------------------------------

test('P1-5 Crash A: run created but no mutation -> NOT completed, safe-to-resume', () => {
  const repo = makeScratchRepo()
  try {
    const slice = buildExactSlice(repo, 'HEAD', ['app.js'])
    const run = orphanedRun('WU-A')
    const result = reconcileOrphanedRun({
      run,
      slice,
      projectRoot: repo,
      grant: makeGrant(repo),
    })
    assert.equal(result.orphaned, true, 'non-terminal run is orphaned')
    assert.equal(result.decision, 'safe-to-resume')
    assert.deepEqual(result.attributedChanges, [])
    assert.notEqual(result.decision, 'reconciled-completed', 'crash does NOT fabricate completion')
  } finally {
    cleanup(repo)
  }
})

// --- Crash B: harness mutated the repo, evidence not persisted --------------

test('P1-5 Crash B: mutation happened but evidence not persisted -> effect attributed, never blind retry', () => {
  const repo = makeScratchRepo()
  try {
    const slice = buildExactSlice(repo, 'HEAD', ['app.js'])
    // Simulate the orphaned run having mutated app.js before the crash.
    writeFileSync(join(repo, 'app.js'), 'const a = 2\n')
    const run = orphanedRun('WU-B')
    const result = reconcileOrphanedRun({
      run,
      slice,
      projectRoot: repo,
      grant: makeGrant(repo),
    })
    assert.equal(result.orphaned, true)
    // The effect is attributed to the orphaned run; re-running would double it.
    assert.equal(result.decision, 'requires-new-run')
    assert.deepEqual(result.attributedChanges, ['app.js'])
    assert.ok(
      result.observations.some((o) => o.kind === 'effect' && o.summary.includes('attributable')),
      'effect is attributed to the original run',
    )
    // The run's history must NOT be overwritten.
    assert.equal(result.run.id, run.id)
  } finally {
    cleanup(repo)
  }
})

// --- Crash C: session terminal but run not closed ---------------------------

test('P1-5 Crash C: session artifact known but repo clean -> effect-unknown (UNKNOWN != RETRY)', () => {
  const repo = makeScratchRepo()
  try {
    const slice = buildExactSlice(repo, 'HEAD', ['app.js'])
    const run = orphanedRun('WU-C')
    const result = reconcileOrphanedRun({
      run,
      slice,
      projectRoot: repo,
      grant: makeGrant(repo),
      sessionArtifactKnown: true,
    })
    assert.equal(result.orphaned, true)
    // A session artifact exists but no repo change: external effects cannot be
    // excluded, so the machine must NOT blind-retry.
    assert.equal(result.decision, 'effect-unknown')
    assert.notEqual(result.decision, 'safe-to-resume')
    assert.notEqual(result.decision, 'requires-new-run')
  } finally {
    cleanup(repo)
  }
})

// --- Crash D: mutation then external HEAD / facts changed -------------------

test('P1-5 Crash D: mutation + stale authority -> requires-reauthorization, not resume', () => {
  const repo = makeScratchRepo()
  try {
    const grant = makeGrant(repo)
    // The grant was issued at the ORIGINAL HEAD; then an external actor moved
    // the HEAD (e.g. a concurrent push/commit).
    writeFileSync(join(repo, 'app.js'), 'const a = 3\n')
    execFileSync('git', ['-C', repo, 'add', '.'])
    execFileSync('git', ['-C', repo, 'commit', '-qm', 'external change'])
    // A second mutation attributed to the orphaned run.
    writeFileSync(join(repo, 'app.js'), 'const a = 4\n')

    const slice = buildExactSlice(repo, grant.authorization.write_target.base_ref, ['app.js'])
    const run = orphanedRun('WU-D')
    const result = reconcileOrphanedRun({
      run,
      slice,
      projectRoot: repo,
      grant,
    })
    assert.equal(result.orphaned, true)
    // HEAD moved relative to the grant base_ref -> the authority is stale.
    assert.equal(result.decision, 'requires-reauthorization')
    assert.ok(
      result.observations.some((o) => o.kind === 'authority' && o.summary.includes('stale')),
      'stale authority blocks resume',
    )
  } finally {
    cleanup(repo)
  }
})

// --- Out-of-slice changes always need a human -------------------------------

test('P1-5: changes outside the authorized slice -> needs-human, never retry', () => {
  const repo = makeScratchRepo()
  try {
    const slice = buildExactSlice(repo, 'HEAD', ['app.js'])
    writeFileSync(join(repo, 'other.js'), 'const b = 9\n')
    const run = orphanedRun('WU-OUT')
    const result = reconcileOrphanedRun({
      run,
      slice,
      projectRoot: repo,
      grant: makeGrant(repo),
    })
    assert.equal(result.decision, 'needs-human')
    assert.deepEqual(result.attributedChanges, [])
  } finally {
    cleanup(repo)
  }
})

// --- Unknown slice: reality cannot bound -> needs-human ---------------------

test('P1-5: unknown slice -> cannot bound, needs-human (no blind retry)', () => {
  const repo = makeScratchRepo()
  try {
    const slice = buildUnknownSlice(repo, 'HEAD')
    writeFileSync(join(repo, 'app.js'), 'const a = 5\n')
    const run = orphanedRun('WU-UNKNOWN')
    const result = reconcileOrphanedRun({
      run,
      slice,
      projectRoot: repo,
      grant: makeGrant(repo),
    })
    assert.equal(result.decision, 'needs-human')
  } finally {
    cleanup(repo)
  }
})

// --- reconcileOrphanedRuns: startup scan over the store ---------------------

test('P1-5: reconcileOrphanedRuns scans durable runs and only touches non-terminal ones', () => {
  const repo = makeScratchRepo()
  try {
    const slice = buildExactSlice(repo, 'HEAD', ['app.js'])
    const running = orphanedRun('WU-1')
    const terminal = closeExecutionRun(orphanedRun('WU-2'), {
      status: 'completed',
      outcome: { runStatus: 'completed', effect: 'no-mutation', verification: 'passed', acceptance: 'pending', reason: 'done' },
    })
    const runs = [toPersistedExecutionRun(running), toPersistedExecutionRun(terminal)]

    const results = reconcileOrphanedRuns(runs, {
      slice,
      projectRoot: repo,
      grantsByRunId: { [running.id]: makeGrant(repo) },
      sessionArtifactKnownForRunId: () => false,
    })
    assert.equal(results.length, 1, 'only the non-terminal run is reconciled')
    assert.equal(results[0].run.id, running.id)
    assert.equal(results[0].orphaned, true)
    // The terminal run keeps its status; no history is rewritten.
    const restoredTerminal = fromPersistedExecutionRun(runs[1])
    assert.equal(restoredTerminal.status, 'completed')
  } finally {
    cleanup(repo)
  }
})

// --- Crash is a fact: recovery observations trace to the original run -------

test('P1-5: recovery produces evidence that traces to the original run (crash is not erased)', () => {
  const repo = makeScratchRepo()
  try {
    const slice = buildExactSlice(repo, 'HEAD', ['app.js'])
    writeFileSync(join(repo, 'app.js'), 'const a = 6\n')
    const run = orphanedRun('WU-TRACE')
    const result = reconcileOrphanedRun({
      run,
      slice,
      projectRoot: repo,
      grant: makeGrant(repo),
      now: '2026-08-15T12:00:00.000Z',
    })
    assert.equal(result.run.id, run.id, 'evidence points to the original run')
    assert.equal(result.reconciledAt, '2026-08-15T12:00:00.000Z')
    assert.ok(result.observations.length >= 2, 'repository + effect observations recorded')
    assert.ok(result.observations.every((o) => o.summary.length > 0))
  } finally {
    cleanup(repo)
  }
})

// --- NON_TERMINAL_STATUSES invariant ----------------------------------------

test('P1-5: terminal statuses are excluded from orphan reconciliation', () => {
  assert.ok(NON_TERMINAL_STATUSES.has('started'))
  assert.ok(NON_TERMINAL_STATUSES.has('running'))
  for (const terminal of ['completed', 'failed', 'interrupted', 'orphaned']) {
    assert.equal(NON_TERMINAL_STATUSES.has(terminal), false)
  }
})

// --- HTTP: /api/reconcile-orphans after a simulated crash -------------------

test('P1-5 HTTP: a crashed started run is reported orphaned via /api/reconcile-orphans', async () => {
  const repo = makeScratchRepo()
  const storeDir = mkdtempSync(join(tmpdir(), 'mw-orphan-api-'))
  try {
    const { startLocalWorkbenchServer } = await import('../.tmp/index.js')
    const { createFileWorkUnitStore } = await import('../.tmp/persistence/file-work-unit-store.js')
    const { toPersistedWorkUnit } = await import('../.tmp/persistence/work-unit-store.js')

    // Simulate a crash: an ExecutionRun was opened (started) but never closed,
    // and its record is durable in the store file before the "restart".
    const store = createFileWorkUnitStore(storeDir)
    const run = orphanedRun('WU-CRASH')
    store.save({
      storeVersion: 3,
      projectRoot: repo,
      workUnits: [{
        id: 'WU-CRASH',
        spaceId: 'SPACE-crash',
        title: 'crash test',
        outcome: 'outcome',
        state: 'running',
        owner: 'human',
        gate: { kind: 'none', open: false },
        acceptance: [],
        evidence: [],
        assets: [],
        createdAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T00:00:00.000Z',
      }],
      grants: {},
      runs: [toPersistedExecutionRun(run)],
      verifications: [],
      lastProjectRoot: repo,
    })

    // Restart: a fresh server reads the same store file.
    const handle = await startLocalWorkbenchServer(
      {
        projectRoot: repo,
        workbenchRoot: '/workbench',
        harnessCheckout: '/harness',
        port: 0,
        storeDir,
      },
      {
        resolveOnboarding: () => ({ status: 'ready' }),
        runIntake: async (options) => ({
          status: 'ready',
          space: { id: 'SPACE-crash', title: 'Crash', projectId: 'crash', projectRoot: repo, domainPackId: 'development-aaop' },
          workUnit: { id: 'WU-CRASH', title: options.rawRequest, outcome: options.rawRequest, state: 'running', gate: { kind: 'none', open: false }, acceptance: [], evidence: [], assets: [], createdAt: 'x', updatedAt: 'x' },
          intake: {},
        }),
      },
    )
    try {
      const res = await fetch(`${handle.url}/api/reconcile-orphans`, {
        method: 'POST',
        headers: {
          'x-ming-workbench-token': handle.requestToken,
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      })
      assert.equal(res.status, 200)
      const body = await res.json()
      assert.equal(body.status, 'reconciled')
      assert.equal(body.orphaned, 1)
      assert.equal(body.results.length, 1)
      assert.equal(body.results[0].runId, run.id)
      assert.equal(body.results[0].workUnitId, 'WU-CRASH')
      assert.equal(body.results[0].orphaned, true)
      assert.ok(body.results[0].decision, 'a recovery decision is produced')
      // The run was NOT fabricated as completed; it stays orphaned until a
      // human / fresh authorization decides.
      const reloaded = createFileWorkUnitStore(storeDir).load()
      const persistedRun = reloaded.runs.find((r) => r.id === run.id)
      assert.equal(persistedRun.status, 'orphaned')
      assert.notEqual(persistedRun.status, 'completed')
    } finally {
      await handle.close()
    }
  } finally {
    cleanup(repo)
    cleanup(storeDir)
  }
})
