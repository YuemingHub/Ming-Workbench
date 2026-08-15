import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openExecutionRun, closeExecutionRun } from '../.tmp/execution/execution-run.js'
import {
  buildExecutionFingerprint,
  sameExecutionFingerprint,
  WORKBENCH_WRITE_PROFILE_ID,
} from '../.tmp/execution/execution-fingerprint.js'
import { createFileWorkUnitStore } from '../.tmp/persistence/file-work-unit-store.js'
import {
  emptyStore,
  WORK_UNIT_STORE_FILE_NAME,
  WORK_UNIT_STORE_VERSION,
  toPersistedExecutionRun,
  fromPersistedExecutionRun,
} from '../.tmp/persistence/work-unit-store.js'
import { startLocalWorkbenchServer } from '../.tmp/index.js'

/**
 * P1-1: first-class ExecutionRun.
 *
 * A Work Unit is the human's durable goal; a retry / re-authorization / provider
 * switch / verifier each open a NEW run. The run record (not the Work Unit)
 * carries execution detail, and runs must survive close/reopen via the store.
 *
 * P1-2: each run additionally records its reconstructable runtime identity
 * (ExecutionFingerprint) so we can answer "what environment produced this?"
 * months later without replaying the session.
 */

function makeScratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'mw-run-'))
  execFileSync('git', ['-C', dir, 'init', '-q'])
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@example.com'])
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'tester'])
  writeFileSync(join(dir, 'seed.txt'), 'seed')
  execFileSync('git', ['-C', dir, 'add', '.'])
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'init'])
  return dir
}

/** A fake reviewed-Harness checkout: enough for inspectHarnessCheckout. */
function makeHarnessCheckout() {
  const dir = mkdtempSync(join(tmpdir(), 'mw-harness-'))
  execFileSync('git', ['-C', dir, 'init', '-q'])
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@example.com'])
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'tester'])
  mkdirSync(join(dir, 'apps', 'cli'), { recursive: true })
  writeFileSync(join(dir, 'apps', 'cli', 'package.json'), JSON.stringify({ version: '0.1.0-rc.5' }))
  execFileSync('git', ['-C', dir, 'add', '.'])
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'harness'])
  return dir
}

function makeGrant({ repository, baseRef = 'main', boundary = 'write-authorized' }) {
  return {
    schema_version: '1.0',
    grant_id: 'GRANT-fp',
    provider: 'deepseek-official',
    route: 'bug-fix',
    working_contract_revision: 1,
    goal: 'fix',
    baseline: [],
    execution_mode: 'single-agent',
    tasks: [],
    authorization: {
      mutation_boundary: boundary,
      write_target: boundary === 'read-only' ? null : { repository, base_ref: baseRef, working_ref: 'main' },
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

function readyIntakeResult(rawRequest = '看看这个项目下一步该做什么') {
  return {
    status: 'ready',
    space: {
      id: 'SPACE-fixture',
      title: 'Fixture Project',
      projectId: 'fixture',
      projectRoot: '/workspace/fixture',
      domainPackId: 'development-aaop',
    },
    workUnit: {
      id: 'WU-run-fixture',
      title: rawRequest,
      outcome: rawRequest,
      state: 'ready',
      gate: { kind: 'none', open: false },
      evidence: [
        {
          kind: 'session',
          summary: '已完成只读项目理解。',
          observedAt: '2026-08-15T00:00:00.000Z',
          authoritative: false,
        },
      ],
      nextFrontier: 'Review the current project frontier.',
    },
    intake: {
      situation: 'existing_repository',
      route: 'understand-review',
      routeConfidence: 0.9,
      ambiguities: [],
      questionNeeded: null,
      projectEvidenceSummary: ['Repository inspected read-only.'],
      nextAction: 'Review the current project frontier.',
    },
  }
}

async function withServer(storeDir, fn, extraDeps = {}) {
  const handle = await startLocalWorkbenchServer(
    {
      projectRoot: '/workspace/fixture',
      workbenchRoot: '/workbench',
      harnessCheckout: '/harness',
      port: 0,
      storeDir,
    },
    {
      resolveOnboarding: () => ({ status: 'ready' }),
      runIntake: async (options) => readyIntakeResult(options.rawRequest),
      ...extraDeps,
    },
  )
  try {
    await fn(handle)
  } finally {
    await handle.close()
  }
}

function apiHeaders(handle) {
  return {
    'x-ming-workbench-token': handle.requestToken,
    'content-type': 'application/json',
  }
}

// --- Store migration --------------------------------------------------------

test('P1-1: a v1 store (no runs) loads as v2 with data preserved and runs empty', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mw-run-migrate-'))
  const storeDir = join(dir, 'store')
  mkdirSync(storeDir, { recursive: true })
  // Hand-written v1 file: no `runs` field at all.
  const v1 = {
    storeVersion: 1,
    projectRoot: '/workspace/fixture',
    workUnits: [
      {
        id: 'WU-v1',
        spaceId: 'SPACE-v1',
        title: 'legacy unit',
        outcome: 'legacy',
        state: 'ready',
        owner: 'development-aaop',
        gate: { kind: 'none', open: false },
        acceptance: [],
        evidence: [],
        assets: [],
        createdAt: '2026-08-14T00:00:00.000Z',
        updatedAt: '2026-08-14T00:00:00.000Z',
      },
    ],
    grants: {},
    lastProjectRoot: '/workspace/fixture',
  }
  writeFileSync(join(storeDir, WORK_UNIT_STORE_FILE_NAME), JSON.stringify(v1, null, 2))

  const store = createFileWorkUnitStore(storeDir)
  const loaded = store.load()
  assert.equal(loaded.storeVersion, WORK_UNIT_STORE_VERSION)
  assert.deepEqual(loaded.runs, [])
  assert.equal(loaded.workUnits.length, 1)
  assert.equal(loaded.workUnits[0].id, 'WU-v1')

  // Saving normalizes to the current version; the legacy unit survives.
  store.save({ ...loaded, runs: [...loaded.runs] })
  const reloaded = store.load()
  assert.equal(reloaded.storeVersion, WORK_UNIT_STORE_VERSION)
  assert.equal(reloaded.workUnits[0].id, 'WU-v1')
  assert.deepEqual(reloaded.runs, [])
  cleanup(dir)
})

test('P1-1: an unknown future store version is treated as empty (fail-closed)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mw-run-future-'))
  const storeDir = join(dir, 'store')
  mkdirSync(storeDir, { recursive: true })
  writeFileSync(
    join(storeDir, WORK_UNIT_STORE_FILE_NAME),
    JSON.stringify({ storeVersion: 999, projectRoot: '/x', workUnits: [{ id: 'WU-future' }] }),
  )
  const store = createFileWorkUnitStore(storeDir)
  assert.deepEqual(store.load(), emptyStore())
  cleanup(dir)
})

// --- Run lifecycle ----------------------------------------------------------

test('P1-1: openExecutionRun -> closeExecutionRun captures a complete run record', () => {
  const run = openExecutionRun({
    workUnitId: 'WU-x',
    authorizationRef: 'GRANT-a',
    provider: 'deepseek-harness',
    model: 'deepseek-v4-pro',
  })
  assert.match(run.id, /^RUN-/)
  assert.equal(run.workUnitId, 'WU-x')
  assert.equal(run.authorizationRef, 'GRANT-a')
  assert.equal(run.provider, 'deepseek-harness')
  assert.equal(run.status, 'started')
  assert.ok(run.startedAt)
  assert.equal(run.finishedAt, undefined)
  assert.deepEqual(run.evidenceRefs, [])

  const closed = closeExecutionRun(run, {
    status: 'completed',
    sessionId: 'session-1',
    outcome: {
      runStatus: 'completed',
      effect: 'mutation-observed',
      verification: 'passed',
      acceptance: 'pending',
      reason: 'real evidence',
    },
    evidenceRefs: ['EV-GIT-session-1'],
  })
  assert.equal(closed.id, run.id)
  assert.equal(closed.status, 'completed')
  assert.equal(closed.sessionId, 'session-1')
  assert.equal(closed.outcome.verification, 'passed')
  assert.deepEqual(closed.evidenceRefs, ['EV-GIT-session-1'])
  assert.ok(closed.finishedAt)
})

test('P1-1: run persistence round-trips without grant internals', () => {
  const run = openExecutionRun({
    workUnitId: 'WU-x',
    authorizationRef: 'GRANT-a',
    provider: 'deepseek-harness',
    model: 'deepseek-v4-pro',
  })
  const closed = closeExecutionRun(run, { status: 'failed', outcome: { runStatus: 'failed', effect: 'unknown', verification: 'pending', acceptance: 'pending', reason: 'blocked' } })
  const persisted = toPersistedExecutionRun(closed)
  const restored = fromPersistedExecutionRun(persisted)
  assert.deepEqual(restored, closed)
})

// --- P1-2 ExecutionFingerprint ---------------------------------------------

test('P1-2: buildExecutionFingerprint captures the reconstructable runtime identity', () => {
  const harness = makeHarnessCheckout()
  const repo = makeScratchRepo()
  try {
    const repoHead = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const harnessHead = execFileSync('git', ['-C', harness, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    const grant = makeGrant({ repository: repo, baseRef: 'main' })

    const fp = buildExecutionFingerprint({
      workbenchRoot: '/workspace',
      harnessCheckout: harness,
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      grant,
    })

    assert.equal(fp.harness.version, '0.1.0-rc.5')
    assert.equal(fp.harness.commit, harnessHead)
    assert.equal(fp.profile.id, WORKBENCH_WRITE_PROFILE_ID)
    assert.ok(fp.profile.digest.length === 64, 'profile digest is a sha256')
    assert.equal(fp.provider, 'deepseek-official')
    assert.equal(fp.model, 'deepseek-v4-pro')
    assert.equal(fp.permissionPreset, 'write-authorized')
    assert.equal(fp.sandboxMode, 'workspace-write')
    assert.equal(fp.workspace.repository, repo)
    assert.equal(fp.workspace.baseRef, 'main')
    assert.ok(fp.workbenchConfigDigest.length === 64, 'config digest is a sha256')

    // The fingerprint is stable for the same environment.
    const again = buildExecutionFingerprint({
      workbenchRoot: '/workspace',
      harnessCheckout: harness,
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      grant,
    })
    assert.equal(sameExecutionFingerprint(fp, again), true)
  } finally {
    cleanup(harness)
    cleanup(repo)
  }
})

test('P1-2: read-only grants record a read-only sandbox and no write target', () => {
  const harness = makeHarnessCheckout()
  const repo = makeScratchRepo()
  try {
    const grant = makeGrant({ repository: repo, boundary: 'read-only' })
    const fp = buildExecutionFingerprint({
      workbenchRoot: '/workspace',
      harnessCheckout: harness,
      grant,
    })
    assert.equal(fp.permissionPreset, 'read-only')
    assert.equal(fp.sandboxMode, 'read-only')
    assert.equal(fp.workspace.repository, '')
    assert.equal(fp.workspace.baseRef, '')
  } finally {
    cleanup(harness)
    cleanup(repo)
  }
})

test('P1-2: a changed profile or model changes the fingerprint (drift detection)', () => {
  const harness = makeHarnessCheckout()
  const repo = makeScratchRepo()
  try {
    const grant = makeGrant({ repository: repo })
    const fpA = buildExecutionFingerprint({
      workbenchRoot: '/workspace',
      harnessCheckout: harness,
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      grant,
    })
    const fpB = buildExecutionFingerprint({
      workbenchRoot: '/workspace',
      harnessCheckout: harness,
      provider: 'deepseek-official',
      model: 'deepseek-v4-flash',
      grant,
    })
    assert.equal(sameExecutionFingerprint(fpA, fpB), false)
  } finally {
    cleanup(harness)
    cleanup(repo)
  }
})

test('P1-2: the fingerprint round-trips with the run through the persisted store', () => {
  const harness = makeHarnessCheckout()
  const repo = makeScratchRepo()
  try {
    const grant = makeGrant({ repository: repo })
    const fp = buildExecutionFingerprint({
      workbenchRoot: '/workspace',
      harnessCheckout: harness,
      provider: 'deepseek-official',
      grant,
    })
    const run = openExecutionRun({
      workUnitId: 'WU-x',
      authorizationRef: 'GRANT-a',
      provider: 'deepseek-official',
      fingerprint: fp,
    })
    const closed = closeExecutionRun(run, { status: 'completed', outcome: { runStatus: 'completed', effect: 'mutation-observed', verification: 'passed', acceptance: 'pending', reason: 'ok' } })
    const persisted = toPersistedExecutionRun(closed)
    assert.ok(persisted.fingerprint, 'persisted run keeps the fingerprint')
    const restored = fromPersistedExecutionRun(persisted)
    assert.ok(restored.fingerprint, 'restored run keeps the fingerprint')
    assert.equal(restored.fingerprint?.harness.commit, fp.harness.commit)
    assert.equal(restored.fingerprint?.workspace.repository, repo)
    assert.equal(sameExecutionFingerprint(restored.fingerprint, fp), true)
  } finally {
    cleanup(harness)
    cleanup(repo)
  }
})

// --- /api/runs endpoint -----------------------------------------------------

test('P1-1: /api/runs returns an empty list on a fresh store and honours the workUnitId filter', async () => {
  const storeDir = mkdtempSync(join(tmpdir(), 'mw-run-api-'))
  await withServer(storeDir, async (handle) => {
    const all = await fetch(`${handle.url}/api/runs`, { headers: apiHeaders(handle) })
    assert.equal(all.status, 200)
    const allBody = await all.json()
    assert.equal(allBody.status, 'ok')
    assert.deepEqual(allBody.runs, [])

    const filtered = await fetch(`${handle.url}/api/runs?workUnitId=WU-nope`, {
      headers: apiHeaders(handle),
    })
    assert.equal(filtered.status, 200)
    assert.equal((await filtered.json()).runs.length, 0)
  })
  cleanup(storeDir)
})

// --- execute creates and persists a run -------------------------------------

test('P1-1: a real execute attempt records a durable run even when the write gate blocks it', async () => {
  const scratch = makeScratchRepo()
  const storeDir = mkdtempSync(join(tmpdir(), 'mw-run-exec-'))
  const envKeys = ['DEEPSEEK_API_KEY', 'MING_WORKBENCH_ALLOW_WRITE']
  const savedEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]))
  try {
    // Provider secret present so execution is reachable; write gate stays OFF
    // (default), so the run is recorded as failed rather than executed.
    process.env.DEEPSEEK_API_KEY = 'test-key'

    const handle = await startLocalWorkbenchServer(
      {
        projectRoot: scratch,
        workbenchRoot: '/workbench',
        harnessCheckout: '/harness',
        port: 0,
        storeDir,
      },
      {
        resolveOnboarding: () => ({ status: 'ready' }),
        runIntake: async (options) => readyIntakeResult(options.rawRequest),
      },
    )
    try {
      const headers = apiHeaders(handle)

      // intake persists the Work Unit
      const intake = await fetch(`${handle.url}/api/intake`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ request: 'fix the test' }),
      })
      assert.equal(intake.status, 200)
      const workUnitId = (await intake.json()).workUnit.id

      // human-confirmed exact surface
      const auth = await fetch(`${handle.url}/api/authorize`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ workUnitId, authorize: true, filePaths: ['answer.mjs'] }),
      })
      assert.equal(auth.status, 200)
      const authBody = await auth.json()
      const grantId = authBody.grantId

      // execute: the write gate (default-off) blocks; a failed run is recorded.
      const exec = await fetch(`${handle.url}/api/execute`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ workUnitId }),
      })
      assert.equal(exec.status, 502)
      const execBody = await exec.json()
      assert.equal(execBody.status, 'execution-failed')

      // The failed attempt is a first-class durable run.
      const runsRes = await fetch(`${handle.url}/api/runs?workUnitId=${encodeURIComponent(workUnitId)}`, {
        headers: apiHeaders(handle),
      })
      assert.equal(runsRes.status, 200)
      const runsBody = await runsRes.json()
      assert.equal(runsBody.runs.length, 1)
      const run = runsBody.runs[0]
      assert.equal(run.workUnitId, workUnitId)
      assert.equal(run.authorizationRef, grantId)
      assert.equal(run.provider, 'deepseek-harness')
      assert.equal(run.runtime, 'deepseek-harness')
      assert.equal(run.status, 'failed')
      assert.equal(run.outcome.runStatus, 'failed')
      assert.ok(run.startedAt)
      assert.ok(run.finishedAt)

      // Runs survive a backend restart (fresh store handle reads the same file).
      const store = createFileWorkUnitStore(storeDir)
      const reloaded = store.load()
      assert.equal(reloaded.runs.length, 1)
      assert.equal(reloaded.runs[0].id, run.id)
      assert.equal(reloaded.runs[0].status, 'failed')
    } finally {
      await handle.close()
    }
  } finally {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    cleanup(scratch)
    cleanup(storeDir)
  }
})
