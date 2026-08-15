import test from 'node:test'
import assert from 'node:assert/strict'
import { zstdCompressSync, constants } from 'node:zlib'
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { buildSessionEvidenceProjection } from '../.tmp/execution/evidence-spine.js'
import { closeExecutionRun, openExecutionRun } from '../.tmp/execution/execution-run.js'
import {
  toPersistedExecutionRun,
  fromPersistedExecutionRun,
} from '../.tmp/persistence/work-unit-store.js'

/**
 * P1-3: Ming Evidence Spine.
 *
 * The Workbench never re-parses the Harness event log into a second store. A
 * session's durable artifact (session.jsonl.zstd, written by the reviewed
 * Harness persistence backend) is the canonical Execution Truth, and the
 * Workbench records a pointer-only Evidence Projection over it. These tests
 * verify the projection derives correct facts from an artifact through the
 * official format/zstd primitives, and that the projection round-trips with
 * the run record.
 */

const here = dirname(fileURLToPath(import.meta.url))
const WORKBENCH_ROOT = join(here, '..')
// Real reviewed Harness checkout (harness:prepare output) — required to run
// the projection script under the Harness tsx CLI.
const REAL_HARNESS_CHECKOUT = '/workspace/.workbench/vendor/deepseek-harness'

function harnessCheckoutOrSkip() {
  const tsxCli = join(REAL_HARNESS_CHECKOUT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const jsonlSrc = join(
    REAL_HARNESS_CHECKOUT,
    'packages', 'session', 'session-persistence-jsonl', 'src', 'format.ts',
  )
  if (!existsSync(tsxCli) || !existsSync(jsonlSrc)) {
    return null
  }
  return REAL_HARNESS_CHECKOUT
}

function zstdFrame(text) {
  return zstdCompressSync(Buffer.from(text), {
    params: { [constants.ZSTD_c_checksumFlag]: 1 },
  })
}

/** Write a canonical Harness session artifact: header frame + one event batch frame. */
function writeSessionArtifact(sessionRoot, cwd, sessionId, { eventCount = 3 } = {}) {
  const projectKey = cwd.replace(/\//g, '-').replace(/^-/, '')
  const dir = join(sessionRoot, `--${projectKey}--`, sessionId)
  mkdirSync(dir, { recursive: true })
  const headerLine = JSON.stringify({
    type: 'session',
    version: 0,
    id: sessionId,
    createdAt: 1700000000000,
    cwd,
    delegationDepth: 0,
  })
  const eventLines = Array.from({ length: eventCount }, (_, seq) =>
    JSON.stringify({ type: 'turn/end', seq, time: 1700000001000 + seq }))
  const artifact = Buffer.concat([
    zstdFrame(`${headerLine}\n`),
    zstdFrame(`${eventLines.join('\n')}\n`),
  ])
  const artifactPath = join(dir, 'session.jsonl.zstd')
  writeFileSync(artifactPath, artifact)
  return artifactPath
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // ignore
  }
}

// --- Projection derivation --------------------------------------------------

test('P1-3: projection derives pointer/header/event-range/digest from a canonical session artifact', { skip: harnessCheckoutOrSkip() === null }, () => {
  const harness = harnessCheckoutOrSkip()
  const sessionRoot = mkdtempSync(join(tmpdir(), 'mw-proj-'))
  const cwd = join(tmpdir(), 'mw-proj-repo')
  const sessionId = 'proj-session-1'
  try {
    writeSessionArtifact(sessionRoot, cwd, sessionId, { eventCount: 3 })

    const projection = buildSessionEvidenceProjection({
      workbenchRoot: WORKBENCH_ROOT,
      harnessCheckout: harness,
      sessionRoot,
      cwd,
      sessionId,
    })

    assert.ok(projection, 'projection is produced for an existing artifact')
    assert.equal(projection.session.pointer.sessionId, sessionId)
    assert.equal(projection.session.pointer.cwd, cwd)
    assert.equal(projection.session.pointer.sessionRoot, sessionRoot)
    assert.equal(projection.session.pointer.artifactRel, `--${cwd.replace(/\//g, '-').replace(/^-/, '')}--/${sessionId}/session.jsonl.zstd`)
    assert.ok(projection.session.pointer.artifactPath.endsWith('session.jsonl.zstd'))
    assert.equal(projection.session.header.id, sessionId)
    assert.equal(projection.session.header.version, 0)
    assert.equal(projection.session.header.createdAt, 1700000000000)
    assert.equal(projection.session.header.cwd, cwd)
    assert.equal(projection.session.header.delegationDepth, 0)
    assert.equal(projection.eventRange.count, 3)
    assert.equal(projection.eventRange.firstSeq, 0)
    assert.equal(projection.eventRange.lastSeq, 2)
    assert.ok(/^[0-9a-f]{64}$/.test(projection.session.digest), 'digest is a sha256 hex')
    assert.equal(projection.session.frames, 2)

    // The digest pins the exact artifact bytes: reading the same file again is stable.
    const again = buildSessionEvidenceProjection({
      workbenchRoot: WORKBENCH_ROOT,
      harnessCheckout: harness,
      sessionRoot,
      cwd,
      sessionId,
    })
    assert.equal(again.session.digest, projection.session.digest)
  } finally {
    cleanup(sessionRoot)
  }
})

test('P1-3: projection event range reflects the committed event count', { skip: harnessCheckoutOrSkip() === null }, () => {
  const harness = harnessCheckoutOrSkip()
  const sessionRoot = mkdtempSync(join(tmpdir(), 'mw-proj2-'))
  const cwd = join(tmpdir(), 'mw-proj2-repo')
  const sessionId = 'proj-session-2'
  try {
    writeSessionArtifact(sessionRoot, cwd, sessionId, { eventCount: 7 })
    const projection = buildSessionEvidenceProjection({
      workbenchRoot: WORKBENCH_ROOT,
      harnessCheckout: harness,
      sessionRoot,
      cwd,
      sessionId,
    })
    assert.equal(projection.eventRange.count, 7)
    assert.equal(projection.eventRange.firstSeq, 0)
    assert.equal(projection.eventRange.lastSeq, 6)
  } finally {
    cleanup(sessionRoot)
  }
})

test('P1-3: a missing or unreadable artifact yields no projection (best-effort, never throws)', { skip: harnessCheckoutOrSkip() === null }, () => {
  const harness = harnessCheckoutOrSkip()
  const sessionRoot = mkdtempSync(join(tmpdir(), 'mw-proj3-'))
  const cwd = join(tmpdir(), 'mw-proj3-repo')
  try {
    assert.equal(
      buildSessionEvidenceProjection({
        workbenchRoot: WORKBENCH_ROOT,
        harnessCheckout: harness,
        sessionRoot,
        cwd,
        sessionId: 'no-such-session',
      }),
      undefined,
    )
  } finally {
    cleanup(sessionRoot)
  }
})

test('P1-3: an unreachable harness checkout yields no projection (never throws)', () => {
  const sessionRoot = mkdtempSync(join(tmpdir(), 'mw-proj4-'))
  const cwd = join(tmpdir(), 'mw-proj4-repo')
  try {
    assert.equal(
      buildSessionEvidenceProjection({
        workbenchRoot: WORKBENCH_ROOT,
        harnessCheckout: '/nonexistent-harness-checkout',
        sessionRoot,
        cwd,
        sessionId: 'x',
      }),
      undefined,
    )
  } finally {
    cleanup(sessionRoot)
  }
})

// --- Projection on the run record -------------------------------------------

test('P1-3: the projection round-trips with the run through the persisted shape', { skip: harnessCheckoutOrSkip() === null }, () => {
  const harness = harnessCheckoutOrSkip()
  const sessionRoot = mkdtempSync(join(tmpdir(), 'mw-proj5-'))
  const cwd = join(tmpdir(), 'mw-proj5-repo')
  const sessionId = 'proj-session-5'
  try {
    writeSessionArtifact(sessionRoot, cwd, sessionId)
    const projection = buildSessionEvidenceProjection({
      workbenchRoot: WORKBENCH_ROOT,
      harnessCheckout: harness,
      sessionRoot,
      cwd,
      sessionId,
    })

    const run = openExecutionRun({
      workUnitId: 'WU-proj',
      authorizationRef: 'GRANT-proj',
      provider: 'deepseek-harness',
      model: 'deepseek-v4-pro',
    })
    const closed = closeExecutionRun(run, {
      status: 'completed',
      sessionId,
      projection,
      outcome: {
        runStatus: 'completed',
        effect: 'mutation-observed',
        verification: 'passed',
        acceptance: 'pending',
        reason: 'real evidence',
      },
    })

    const persisted = toPersistedExecutionRun(closed)
    assert.ok(persisted.projection, 'persisted run keeps the projection')
    const restored = fromPersistedExecutionRun(persisted)
    assert.ok(restored.projection, 'restored run keeps the projection')
    assert.equal(restored.projection.session.pointer.sessionId, sessionId)
    assert.equal(restored.projection.eventRange.count, 3)
    assert.equal(restored.projection.session.digest, projection.session.digest)
  } finally {
    cleanup(sessionRoot)
  }
})

test('P1-3: a run closed without a session carries no projection', () => {
  const run = openExecutionRun({
    workUnitId: 'WU-x',
    authorizationRef: 'GRANT-a',
    provider: 'deepseek-harness',
  })
  const closed = closeExecutionRun(run, {
    status: 'failed',
    outcome: {
      runStatus: 'failed',
      effect: 'unknown',
      verification: 'pending',
      acceptance: 'pending',
      reason: 'blocked',
    },
  })
  assert.equal(closed.projection, undefined)
})
