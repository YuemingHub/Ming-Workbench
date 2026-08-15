import test from 'node:test'
import assert from 'node:assert/strict'

import {
  acquireWriteLease,
  releaseWriteLease,
  reconcileStaleLeases,
} from '../.tmp/execution/write-lease.js'

/**
 * P1-6: Repository Write Lease (minimal).
 *
 * One real-world working tree has at most ONE active direct writer ExecutionRun.
 * A second writer on the same repository is blocked until the first is
 * terminal/reconciled. The Independent Verifier (purpose='verification') is
 * read-only and never blocked by the lease. Restart reconciles stale leases.
 */

const REPO_A = '/tmp/repo-a'
const REPO_B = '/tmp/repo-b'

function lease(repository, writerRunId, workUnitId, opts = {}) {
  return {
    repository,
    writerRunId,
    workUnitId,
    grantedAt: '2026-08-15T00:00:00.000Z',
    released: false,
    ...opts,
  }
}

// --- Run A acquires; Run B on same repo is blocked --------------------------

test('P1-6: first writer acquires the lease; second writer on the same repo is blocked', () => {
  const a = acquireWriteLease({
    repository: REPO_A,
    writerRunId: 'RUN-A',
    workUnitId: 'WU-A',
    leases: [],
  })
  assert.equal(a.ok, true)
  assert.ok(a.ok && a.lease.writerRunId === 'RUN-A')

  const b = acquireWriteLease({
    repository: REPO_A,
    writerRunId: 'RUN-B',
    workUnitId: 'WU-B',
    leases: [a.ok ? a.lease : {}],
  })
  assert.equal(b.ok, false)
  if (!b.ok) {
    assert.equal(b.reason, 'held-by-other-writer')
    assert.equal(b.heldBy?.writerRunId, 'RUN-A')
  }
})

// --- Different repositories do not conflict ---------------------------------

test('P1-6: writers on different repositories both acquire their lease', () => {
  const a = acquireWriteLease({
    repository: REPO_A,
    writerRunId: 'RUN-A',
    workUnitId: 'WU-A',
    leases: [],
  })
  const b = acquireWriteLease({
    repository: REPO_B,
    writerRunId: 'RUN-B',
    workUnitId: 'WU-B',
    leases: [a.ok ? a.lease : {}],
  })
  assert.equal(a.ok, true)
  assert.equal(b.ok, true)
})

// --- Lease is released when the run is terminal -----------------------------

test('P1-6: after the writer run is terminal the lease releases, and a new writer can acquire', () => {
  const a = acquireWriteLease({
    repository: REPO_A,
    writerRunId: 'RUN-A',
    workUnitId: 'WU-A',
    leases: [],
  })
  const held = a.ok ? a.lease : {}

  const release = releaseWriteLease([held], REPO_A, 'RUN-A')
  assert.equal(release.ok, true)
  assert.equal(release.released, true)

  const b = acquireWriteLease({
    repository: REPO_A,
    writerRunId: 'RUN-B',
    workUnitId: 'WU-B',
    leases: [release.ok && release.lease ? release.lease : held],
  })
  assert.equal(b.ok, true)
})

// --- A second writer can never release another writer's lease ---------------

test('P1-6: a run can only release its OWN lease', () => {
  const a = acquireWriteLease({
    repository: REPO_A,
    writerRunId: 'RUN-A',
    workUnitId: 'WU-A',
    leases: [],
  })
  const held = a.ok ? a.lease : {}
  const bRelease = releaseWriteLease([held], REPO_A, 'RUN-B')
  assert.equal(bRelease.ok, false)
  if (!bRelease.ok) {
    assert.equal(bRelease.reason, 'held-by-other-writer')
  }
})

// --- Read-only verifier needs no lease and is never blocked -----------------

test('P1-6: read-only verifier (purpose=verification) never needs the write lease', () => {
  const writer = acquireWriteLease({
    repository: REPO_A,
    writerRunId: 'RUN-A',
    workUnitId: 'WU-A',
    leases: [],
  })
  const verifier = acquireWriteLease({
    repository: REPO_A,
    writerRunId: 'RUN-VER',
    workUnitId: 'WU-A',
    purpose: 'verification',
    leases: [writer.ok ? writer.lease : {}],
  })
  assert.equal(verifier.ok, true, 'verifier is not blocked by the writer lease')
})

// --- Restart: stale lease (owner run terminal) is released ------------------

test('P1-6: restart reconciliation releases a stale lease whose owner run is terminal', () => {
  const stale = lease(REPO_A, 'RUN-CRASHED', 'WU-CRASHED')
  const active = lease(REPO_B, 'RUN-ACTIVE', 'WU-ACTIVE')
  const { leases, releasedStale } = reconcileStaleLeases({
    leases: [stale, active],
    isTerminalRun: (runId) => runId === 'RUN-CRASHED',
  })
  assert.deepEqual(releasedStale, ['RUN-CRASHED'])
  assert.equal(leases.find((l) => l.writerRunId === 'RUN-CRASHED').released, true)
  assert.equal(leases.find((l) => l.writerRunId === 'RUN-ACTIVE').released, false)
})

// --- Same run re-acquiring is idempotent ------------------------------------

test('P1-6: the same run re-acquiring its own lease is allowed (idempotent)', () => {
  const a = acquireWriteLease({
    repository: REPO_A,
    writerRunId: 'RUN-A',
    workUnitId: 'WU-A',
    leases: [],
  })
  const again = acquireWriteLease({
    repository: REPO_A,
    writerRunId: 'RUN-A',
    workUnitId: 'WU-A',
    leases: [a.ok ? a.lease : {}],
  })
  assert.equal(again.ok, true)
})

// --- HTTP: execute is blocked by an active write lease -----------------------

test('P1-6 HTTP: a second write execute on the same repo is blocked (409 write-lease-held)', async () => {
  const { mkdtempSync: mkdt, writeFileSync: write, rmSync: rm } = await import('node:fs')
  const { tmpdir: tmp } = await import('node:os')
  const { join } = await import('node:path')
  const { execFileSync: exec } = await import('node:child_process')
  const { startLocalWorkbenchServer } = await import('../.tmp/index.js')
  const { createFileWorkUnitStore } = await import('../.tmp/persistence/file-work-unit-store.js')
  const { toPersistedWorkUnit, toPersistedExecutionRun } = await import('../.tmp/persistence/work-unit-store.js')

  const repo = mkdt(join(tmp(), 'mw-lease-api-'))
  const storeDir = mkdt(join(tmp(), 'mw-lease-api-store-'))
  const envKeys = ['DEEPSEEK_API_KEY', 'MING_WORKBENCH_ALLOW_WRITE']
  const savedEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]))
  try {
    exec('git', ['-C', repo, 'init', '-q'])
    exec('git', ['-C', repo, 'config', 'user.email', 't@example.com'])
    exec('git', ['-C', repo, 'config', 'user.name', 'tester'])
    write(join(repo, 'app.js'), 'const a = 1\n')
    exec('git', ['-C', repo, 'add', '.'])
    exec('git', ['-C', repo, 'commit', '-qm', 'init'])
    process.env.DEEPSEEK_API_KEY = 'test-key'
    process.env.MING_WORKBENCH_ALLOW_WRITE = '1'

    // Pre-seed the store with an ACTIVE lease held by another writer run.
    const store = createFileWorkUnitStore(storeDir)
    store.save({
      storeVersion: 4,
      projectRoot: repo,
      workUnits: [toPersistedWorkUnit({
        id: 'WU-1', spaceId: 'SPACE-l', title: 't', outcome: 'o', state: 'running',
        owner: 'human', gate: { kind: 'none', open: false }, acceptance: [],
        evidence: [], assets: [], createdAt: 'x', updatedAt: 'x',
      })],
      grants: {
        [Object.keys({ g: 1 })[0]]: {
          grant: {
            schema_version: '1.0', grant_id: 'GRANT-1', provider: 'deepseek-harness',
            route: 'bug-fix', working_contract_revision: 1, goal: 'fix', baseline: [],
            execution_mode: 'single-agent', tasks: [],
            authorization: { mutation_boundary: 'write-authorized', write_target: { repository: repo, base_ref: 'HEAD', working_ref: 'main' }, allowed_effects: ['local-git-mutation'], protected_effects: [] },
            acceptance_evidence: [], human_open_questions: [], references: [],
            issued_at: '2026-08-15T00:00:00.000Z',
          },
          binding: { workUnitId: 'WU-1', grantId: 'GRANT-1' },
          slice: { repository: repo, baseRef: 'HEAD', scope: { kind: 'exact', paths: ['app.js'] } },
        },
      },
      runs: [toPersistedExecutionRun({
        id: 'RUN-HELD', workUnitId: 'WU-1', authorizationRef: 'GRANT-1',
        runtime: 'deepseek-harness', provider: 'deepseek-harness', purpose: 'execution',
        status: 'started', startedAt: 'x', evidenceRefs: [],
      })],
      verifications: [],
      leases: [{ repository: repo, writerRunId: 'RUN-HELD', workUnitId: 'WU-1', grantedAt: 'x', released: false }],
      lastProjectRoot: repo,
    })

    const handle = await startLocalWorkbenchServer(
      {
        projectRoot: repo, workbenchRoot: '/workbench', harnessCheckout: '/harness',
        port: 0, storeDir,
      },
      {
        resolveOnboarding: () => ({ status: 'ready' }),
        runIntake: async (options) => ({
          status: 'ready',
          space: { id: 'SPACE-l', title: 'P', projectId: 'p', projectRoot: repo, domainPackId: 'development-aaop' },
          workUnit: { id: 'WU-1', title: options.rawRequest, outcome: options.rawRequest, state: 'ready', gate: { kind: 'none', open: false }, acceptance: [], evidence: [], assets: [], createdAt: 'x', updatedAt: 'x' },
          intake: {},
        }),
      },
    )
    try {
      const headers = {
        'x-ming-workbench-token': handle.requestToken,
        'content-type': 'application/json',
      }
      const res = await fetch(`${handle.url}/api/execute`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ workUnitId: 'WU-1' }),
      })
      assert.equal(res.status, 409)
      const body = await res.json()
      assert.equal(body.status, 'write-lease-held')
      assert.equal(body.heldBy.runId, 'RUN-HELD')
    } finally {
      await handle.close()
    }
  } finally {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    rm(repo, { recursive: true, force: true })
    rm(storeDir, { recursive: true, force: true })
  }
})
