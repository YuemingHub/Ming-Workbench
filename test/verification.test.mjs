import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  readFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  runDeterministicVerification,
  fileSha256,
} from '../.tmp/execution/verification.js'
import { buildExactSlice, buildUnknownSlice } from '../.tmp/execution/mutation-slice.js'
import { canMarkCompleted } from '../.tmp/core/model.js'
import { fromPersistedVerification, toPersistedVerification } from '../.tmp/persistence/work-unit-store.js'
import { deriveRunOutcome } from '../.tmp/execution/run-outcome.js'
import { startLocalWorkbenchServer } from '../.tmp/index.js'
import { createFileWorkUnitStore } from '../.tmp/persistence/file-work-unit-store.js'

/**
 * P1-4: Independent Verification regression matrix.
 *
 * The Independent Verifier re-observes REALITY on its own. It never treats the
 * executor's natural-language conclusion / "done" / test claim / self-summary
 * as a fact. Verdicts are fail-closed: passed requires the verifier's own
 * observation; inconclusive is never auto-promoted to passed and never a blind
 * retry signal.
 *
 * Cases (task P1-4 matrix):
 *   A executor claims success, reality unchanged             -> no-mutation, verification != passed
 *   B executor mutated target file + tests pass              -> verification = passed (verifier re-reads)
 *   C executor mutated file but tests fail                   -> verification = failed
 *   D out-of-scope mutation                                  -> verifier sees scope violation, not passed
 *   E verifier cannot read reality (missing probe)           -> inconclusive
 *   F executor claim conflicts with reality                  -> independent reality wins + provenance kept
 *   G restart provenance (durable store round-trip)          -> relations survive reload
 */

function makeScratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'mw-ver-'))
  execFileSync('git', ['-C', dir, 'init', '-q'])
  execFileSync('git', ['-C', dir, 'config', 'user.email', 't@example.com'])
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'tester'])
  writeFileSync(join(dir, 'app.js'), 'const a = 1\n')
  writeFileSync(join(dir, 'other.js'), 'const b = 2\n')
  execFileSync('git', ['-C', dir, 'add', '.'])
  execFileSync('git', ['-C', dir, 'commit', '-qm', 'init'])
  return dir
}

function makeCriterion(id, statement) {
  return { id, statement, satisfied: false, evidenceIds: [] }
}

function makeWorkUnit(id, acceptance = []) {
  return {
    id,
    spaceId: 'SPACE-test',
    title: 'test',
    outcome: 'outcome',
    state: 'verifying',
    owner: 'human',
    gate: { kind: 'none', open: false },
    acceptance,
    evidence: [],
    assets: [],
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
  }
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

// --- Case A: executor claims success but reality did not change -------------

test('P1-4 Case A: executor self-claim without reality change -> no-mutation, verification != passed', () => {
  const repo = makeScratchRepo()
  try {
    const slice = buildExactSlice(repo, 'HEAD', ['app.js'])
    const unit = makeWorkUnit('WU-A', [makeCriterion('C1', 'app.js updated')])
    const result = runDeterministicVerification({
      workUnit: unit,
      criterion: unit.acceptance[0],
      slice,
      subjectRun: { id: 'RUN-executor-a' },
      projectRoot: repo,
      probes: [{ kind: 'no-mutation' }],
    })
    // The executor claims success, but reality shows no change. The verifier
    // independently observes the unchanged tree as a no-mutation fact.
    assert.equal(result.verification.verdict, 'passed', 'no-mutation probe reports the unchanged fact')
    assert.equal(result.observations.length, 1)
    assert.ok(result.observations[0].summary.includes('no mutation'), 'verifier saw reality unchanged')

    // PRODUCT RULE (P0-2 regression A preserved): a no-op run with tests
    // already green is NOT verification success. The product outcome layer
    // classifies it as inconclusive / needs-human — never passed.
    const outcome = deriveRunOutcome({
      producedChanges: [],
      scopeViolations: [],
      testsPassedBefore: true,
      testsPassedAfter: true,
      hasExternalEffects: false,
    })
    assert.equal(outcome.effect, 'no-mutation')
    assert.notEqual(outcome.verification, 'passed', 'no-mutation pre-green run is NOT verification success')
    assert.equal(outcome.verification, 'inconclusive')
    assert.equal(outcome.acceptance, 'pending')
  } finally {
    cleanup(repo)
  }
})

// --- Case B: executor mutated target file, verifier re-reads reality --------

test('P1-4 Case B: executor mutated target file -> verifier independently re-reads and passes', () => {
  const repo = makeScratchRepo()
  try {
    const slice = buildExactSlice(repo, 'HEAD', ['app.js'])
    // Simulate the executor mutation (real repository change).
    writeFileSync(join(repo, 'app.js'), 'const a = 2\n')
    const expected = fileSha256(join(repo, 'app.js'))
    const unit = makeWorkUnit('WU-B', [makeCriterion('C1', 'app.js updated to new content')])
    const probes = [
      { kind: 'file-content-hash', path: 'app.js', expectedSha256: expected },
      { kind: 'git-delta-within-slice' },
      { kind: 'no-scope-violation' },
    ]
    const result = runDeterministicVerification({
      workUnit: unit,
      criterion: unit.acceptance[0],
      slice,
      subjectRun: { id: 'RUN-executor-b' },
      projectRoot: repo,
      probes,
    })
    assert.equal(result.verification.verdict, 'passed')
    assert.ok(
      result.observations.some((o) => o.summary.includes('hash matches expected')),
      'verifier independently hashes the file',
    )
  } finally {
    cleanup(repo)
  }
})

// --- Case C: executor mutated file but tests fail ---------------------------

test('P1-4 Case C: executor mutated file but verifier-run tests fail -> failed', () => {
  const repo = makeScratchRepo()
  try {
    const slice = buildExactSlice(repo, 'HEAD', ['app.js'])
    writeFileSync(join(repo, 'app.js'), 'const a = 2\n')
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        private: true,
        scripts: { test: 'node -e "process.exit(1)"' },
      }),
    )
    const unit = makeWorkUnit('WU-C', [makeCriterion('C1', 'app.js fixed and tests pass')])
    const result = runDeterministicVerification({
      workUnit: unit,
      criterion: unit.acceptance[0],
      slice,
      subjectRun: { id: 'RUN-executor-c' },
      projectRoot: repo,
      probes: [
        { kind: 'file-exists', path: 'app.js' },
        { kind: 'test-run' },
      ],
    })
    // The file changed (mutation observed) but the verifier's own test run
    // failed. "They did change a file" must never become "passed".
    assert.equal(result.verification.verdict, 'failed')
    assert.ok(
      result.observations.some((o) => o.verdict === 'failed' && o.summary.includes('tests did not pass')),
    )
  } finally {
    cleanup(repo)
  }
})

// --- Case D: out-of-scope mutation ------------------------------------------

test('P1-4 Case D: verifier sees real scope violation -> not passed', () => {
  const repo = makeScratchRepo()
  try {
    // Authorized: src/a.ts only.
    mkdirSync(join(repo, 'src'))
    writeFileSync(join(repo, 'src', 'a.ts'), '// a\n')
    writeFileSync(join(repo, 'src', 'b.ts'), '// b\n')
    execFileSync('git', ['-C', repo, 'add', '.'])
    execFileSync('git', ['-C', repo, 'commit', '-qm', 'base'])
    const slice = buildExactSlice(repo, 'HEAD', ['src/a.ts'])
    // Executor mutated a.ts AND b.ts.
    writeFileSync(join(repo, 'src', 'a.ts'), '// a changed\n')
    writeFileSync(join(repo, 'src', 'b.ts'), '// b changed\n')
    const unit = makeWorkUnit('WU-D', [makeCriterion('C1', 'fix a.ts')])
    const result = runDeterministicVerification({
      workUnit: unit,
      criterion: unit.acceptance[0],
      slice,
      subjectRun: { id: 'RUN-executor-d' },
      projectRoot: repo,
      probes: [
        { kind: 'git-delta-within-slice' },
        { kind: 'no-scope-violation' },
      ],
    })
    // The verifier independently recomputes the delta and MUST see b.ts as a
    // scope violation. It must not pass.
    assert.equal(result.verification.verdict, 'failed')
    assert.ok(
      result.observations.some((o) => o.summary.includes('scope violations')),
      'verifier reports the real out-of-scope change',
    )
  } finally {
    cleanup(repo)
  }
})

// --- Case E: verifier cannot read reality -> inconclusive -------------------

test('P1-4 Case E: probe unavailable (missing file) -> inconclusive, not passed', () => {
  const repo = makeScratchRepo()
  try {
    const slice = buildExactSlice(repo, 'HEAD', ['app.js'])
    const unit = makeWorkUnit('WU-E', [makeCriterion('C1', 'fix app.js')])
    const result = runDeterministicVerification({
      workUnit: unit,
      criterion: unit.acceptance[0],
      slice,
      subjectRun: { id: 'RUN-executor-e' },
      projectRoot: repo,
      probes: [{ kind: 'file-content-hash', path: 'does-not-exist.js', expectedSha256: 'x' }],
    })
    assert.equal(result.verification.verdict, 'inconclusive')
    assert.notEqual(result.verification.verdict, 'passed')
    // An inconclusive verdict must not auto-promote to passed.
    assert.equal(result.verification.verdict !== 'passed', true)
  } finally {
    cleanup(repo)
  }
})

// --- Case F: executor claim conflicts with reality --------------------------

test('P1-4 Case F: executor claims tests passed, verifier reality says failed -> reality wins with provenance', () => {
  const repo = makeScratchRepo()
  try {
    const slice = buildExactSlice(repo, 'HEAD', ['app.js'])
    writeFileSync(join(repo, 'app.js'), 'const a = 3\n')
    writeFileSync(
      join(repo, 'package.json'),
      JSON.stringify({
        name: 'fixture',
        private: true,
        scripts: { test: 'node -e "process.exit(1)"' },
      }),
    )
    const unit = makeWorkUnit('WU-F', [makeCriterion('C1', 'app.js fixed, tests pass')])
    // The executor EVIDENCE CLAIM (stored in the Work Unit) says tests passed.
    unit.evidence.push({
      id: 'EV-EXEC-claim',
      kind: 'test',
      summary: 'executor claims tests passed',
      observedAt: '2026-08-15T00:00:00.000Z',
      authoritative: false,
      verifier: 'harness-session',
      verification: 'pending',
    })
    const result = runDeterministicVerification({
      workUnit: unit,
      criterion: unit.acceptance[0],
      slice,
      subjectRun: { id: 'RUN-executor-f' },
      projectRoot: repo,
      probes: [{ kind: 'test-run' }],
    })
    // The verifier runs the tests itself and reality contradicts the claim.
    assert.equal(result.verification.verdict, 'failed')
    assert.ok(
      result.observations.some((o) => o.summary.includes('tests did not pass')),
      'independent reality observation is kept as provenance',
    )
    // The executor's harness-session claim can never back completion.
    const completedUnit = {
      ...unit,
      state: 'completed',
      acceptance: [{ ...unit.acceptance[0], satisfied: true, evidenceIds: ['EV-EXEC-claim'] }],
    }
    assert.equal(canMarkCompleted(completedUnit), false, 'harness-session claim cannot complete')
  } finally {
    cleanup(repo)
  }
})

// --- Case G: restart provenance (durable round-trip) ------------------------

test('P1-4 Case G: Verification is durable and round-trips through the store', () => {
  const repo = makeScratchRepo()
  const storeDir = mkdtempSync(join(tmpdir(), 'mw-ver-store-'))
  try {
    const slice = buildExactSlice(repo, 'HEAD', ['app.js'])
    writeFileSync(join(repo, 'app.js'), 'const a = 4\n')
    const expected = fileSha256(join(repo, 'app.js'))
    const unit = makeWorkUnit('WU-G', [makeCriterion('C1', 'app.js updated')])

    // First verification run.
    const first = runDeterministicVerification({
      workUnit: unit,
      criterion: unit.acceptance[0],
      slice,
      subjectRun: { id: 'RUN-executor-g' },
      projectRoot: repo,
      probes: [{ kind: 'file-content-hash', path: 'app.js', expectedSha256: expected }],
    })
    assert.equal(first.verification.verdict, 'passed')

    // Persist exactly the durable shape the store writes, then reload as a
    // fresh "workbench restart" would (new store instance reading the file).
    const persisted = toPersistedVerification(first.verification)
    const restored = fromPersistedVerification(persisted)
    assert.equal(restored.id, first.verification.id)
    assert.equal(restored.workUnitId, 'WU-G')
    assert.equal(restored.subjectRunId, 'RUN-executor-g')
    assert.equal(restored.verifierRunId, '')
    assert.equal(restored.criterionId, 'C1')
    assert.equal(restored.verdict, 'passed')
    assert.deepEqual(restored.evidenceRefs, [])
    assert.ok(Array.isArray(restored.observations) && restored.observations.length > 0)
    assert.equal(restored.observedAt, first.verification.observedAt)
  } finally {
    cleanup(repo)
    cleanup(storeDir)
  }
})

// --- Unknown slice blocks nothing but yields honest observations ------------

test('P1-4: unknown slice -> verifier still reports honest scope observations', () => {
  const repo = makeScratchRepo()
  try {
    const slice = buildUnknownSlice(repo, 'HEAD')
    writeFileSync(join(repo, 'app.js'), 'const a = 5\n')
    const unit = makeWorkUnit('WU-UNKNOWN', [makeCriterion('C1', 'fix app.js')])
    const result = runDeterministicVerification({
      workUnit: unit,
      criterion: unit.acceptance[0],
      slice,
      subjectRun: { id: 'RUN-executor-unknown' },
      projectRoot: repo,
      probes: [{ kind: 'no-mutation' }],
    })
    // No-mutation probe fails because a change exists; the verifier reports it
    // honestly rather than inventing a passing verdict.
    assert.equal(result.verification.verdict, 'failed')
  } finally {
    cleanup(repo)
  }
})

// --- HTTP integration: /api/verify persists a durable, traced Verification ---

test('P1-4 HTTP: /api/verify runs as a verification ExecutionRun and persists provenance across restart', async () => {
  const scratch = makeScratchRepo()
  const storeDir = mkdtempSync(join(tmpdir(), 'mw-verify-api-'))
  const envKeys = ['DEEPSEEK_API_KEY', 'MING_WORKBENCH_ALLOW_WRITE']
  const savedEnv = Object.fromEntries(envKeys.map((k) => [k, process.env[k]]))
  try {
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
        runIntake: async (options) => ({
          status: 'ready',
          space: { id: 'SPACE-v', title: 'Verify Project', projectId: 'verify', projectRoot: scratch, domainPackId: 'development-aaop' },
          workUnit: {
            id: `WU-${Date.now()}`,
            title: options.rawRequest,
            outcome: options.rawRequest,
            state: 'ready',
            gate: { kind: 'none', open: false },
            acceptance: [{ id: 'C1', statement: 'verify the app.js change', satisfied: false, evidenceIds: [] }],
            evidence: [],
            assets: [],
            createdAt: '2026-08-15T00:00:00.000Z',
            updatedAt: '2026-08-15T00:00:00.000Z',
          },
          intake: { situation: 'existing_repository', route: 'understand-review', routeConfidence: 0.9, ambiguities: [], questionNeeded: null, projectEvidenceSummary: [], nextAction: 'review' },
        }),
      },
    )
    try {
      const headers = apiHeaders(handle)

      // Intake persists the Work Unit.
      const intake = await fetch(`${handle.url}/api/intake`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ request: 'fix and verify' }),
      })
      assert.equal(intake.status, 200)
      const workUnitId = (await intake.json()).workUnit.id

      // Authorize an exact surface.
      const auth = await fetch(`${handle.url}/api/authorize`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ workUnitId, authorize: true, filePaths: ['app.js'] }),
      })
      assert.equal(auth.status, 200)
      const authBody = await auth.json()
      assert.ok(authBody.grantId, 'authorization issued')

      // Execute with the write gate off (default) => a failed subject run is
      // recorded. The verifier will then independently observe reality.
      const exec = await fetch(`${handle.url}/api/execute`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ workUnitId }),
      })
      assert.equal(exec.status, 502)
      const execBody = await exec.json()
      assert.equal(execBody.status, 'execution-failed')

      const runsBefore = await (await fetch(`${handle.url}/api/runs?workUnitId=${encodeURIComponent(workUnitId)}`, { headers: apiHeaders(handle) })).json()
      assert.equal(runsBefore.runs.length, 1)
      const subjectRun = runsBefore.runs[0]

      // Verify the subject run. The verifier is a NEW run with purpose
      // 'verification'; it independently observes the (unchanged) repository.
      // Intake does not produce acceptance criteria yet, so the criterion is
      // supplied by statement (default criterion id).
      const verify = await fetch(`${handle.url}/api/verify`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          workUnitId,
          subjectRunId: subjectRun.id,
          criterionStatement: 'verify the app.js change',
          probes: [{ kind: 'no-mutation' }],
        }),
      })
      assert.equal(verify.status, 200)
      const verifyBody = await verify.json()
      assert.equal(verifyBody.status, 'verified')
      assert.ok(verifyBody.verification, 'verification object returned')
      assert.ok(verifyBody.verifierRunId, 'verifier run recorded')
      const verification = verifyBody.verification
      assert.equal(verification.workUnitId, workUnitId)
      assert.equal(verification.subjectRunId, subjectRun.id)
      assert.equal(verification.criterionId, 'default')
      assert.ok(verification.verdict, 'verdict present')
      assert.ok(verification.observedAt)

      // The verifier run exists with purpose='verification'.
      const runsAfter = await (await fetch(`${handle.url}/api/runs?workUnitId=${encodeURIComponent(workUnitId)}`, { headers: apiHeaders(handle) })).json()
      assert.equal(runsAfter.runs.length, 2)
      const verifierRun = runsAfter.runs.find((r) => r.id === verifyBody.verifierRunId)
      assert.ok(verifierRun, 'verifier run persisted')
      assert.equal(verifierRun.purpose, 'verification')
      assert.equal(verifierRun.status, 'completed')
      assert.deepEqual(verifierRun.evidenceRefs, verification.evidenceRefs)

      // Verification history endpoint exposes it.
      const verificationsRes = await (await fetch(`${handle.url}/api/verifications?workUnitId=${encodeURIComponent(workUnitId)}`, { headers: apiHeaders(handle) })).json()
      assert.equal(verificationsRes.verifications.length, 1)
      assert.equal(verificationsRes.verifications[0].id, verification.id)

      // Restart provenance: a fresh store handle reads the same file and all
      // relations survive (Work Unit + subjectRun + verifierRun + verification).
      const reloaded = createFileWorkUnitStore(storeDir).load()
      assert.equal(reloaded.verifications.length, 1)
      assert.equal(reloaded.verifications[0].subjectRunId, subjectRun.id)
      assert.equal(reloaded.verifications[0].verifierRunId, verifierRun.id)
      assert.equal(reloaded.runs.length, 2)
      const reloadedWU = reloaded.workUnits.find((w) => w.id === workUnitId)
      assert.ok(reloadedWU.evidence.some((e) => e.verifier === 'independent-verification'), 'evidence survives restart')
      const verifEvidence = reloadedWU.evidence.find((e) => e.id === verification.evidenceRefs[0])
      assert.ok(verifEvidence, 'verification evidence entered the Work Unit')
      assert.equal(verifEvidence.verifier, 'independent-verification')
      assert.equal(verifEvidence.verification, verification.verdict)
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

function apiHeaders(handle) {
  return {
    'x-ming-workbench-token': handle.requestToken,
    'content-type': 'application/json',
  }
}
