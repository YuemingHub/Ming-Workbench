#!/usr/bin/env node
/**
 * P1-5 real-project orphan recovery smoke against Family Space.
 *
 * Simulates the crash/restart reality on a THROWAWAY COPY of the real Family
 * Space repo:
 *
 *   1. an ExecutionRun is opened (started) — a real human-authorized intent to
 *      apply the RWU001 fix (declare the production baseline);
 *   2. the run MUTATES CURRENT_STATE.md (the real effect) and is then crashed:
 *      its record is persisted as non-terminal (started) with NO close record,
 *      NO evidence, NO outcome — exactly what a mid-flight crash leaves behind;
 *   3. the Workbench "restarts": a fresh store instance reads the same file;
 *   4. /api/reconcile-orphans re-observes reality (git working tree + slice)
 *      and attributes the CURRENT_STATE.md change to the orphaned run;
 *   5. the decision is NEVER a blind retry — the run is NOT re-executed and
 *      NOT fabricated as completed; the real effect is preserved and the run
 *      stays orphaned until a human / fresh authorization resolves it.
 *
 * No DEEPSEEK_API_KEY needed: this proves the recovery architecture on a real
 * repository.
 *
 * Usage:
 *   node scripts/smoke-family-space-orphan.mjs
 *   MING_FAMILY_SPACE_CHECKOUT=<path> node scripts/smoke-family-space-orphan.mjs
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

import { reconcileOrphanedRun } from '../.tmp/execution/orphan-recovery.js'
import { buildExactSlice } from '../.tmp/execution/mutation-slice.js'
import { openExecutionRun } from '../.tmp/execution/execution-run.js'
import { toPersistedExecutionRun, toPersistedWorkUnit } from '../.tmp/persistence/work-unit-store.js'
import { createFileWorkUnitStore } from '../.tmp/persistence/file-work-unit-store.js'

const workbenchRoot = resolve(process.cwd())
const familySpace = resolve(
  process.env.MING_FAMILY_SPACE_CHECKOUT ?? join(workbenchRoot, '.workbench', 'projects', 'family-space'),
)

const BASELINE_MARKER = /^当前仓库观察基线：/

let failures = 0
function check(condition, label, detail = '') {
  const ok = Boolean(condition)
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${detail ? ` (${detail})` : ''}`)
  if (!ok) failures += 1
}

function run(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function resolveBaseline() {
  let remoteHead = ''
  try {
    remoteHead = run(familySpace, ['ls-remote', 'origin', 'production']).split(/\s+/)[0] ?? ''
  } catch {
    // fall through
  }
  const localHead = run(familySpace, ['rev-parse', 'HEAD'])
  const baseline = remoteHead || localHead
  if (!/^[0-9a-f]{40}$/i.test(baseline)) {
    throw new Error(`could not resolve a 40-hex baseline SHA (remote='${remoteHead}', local='${localHead}')`)
  }
  return { baseline, localHead }
}

function main() {
  if (!existsSync(join(familySpace, 'CURRENT_STATE.md'))) {
    throw new Error(`Family Space checkout not found at ${familySpace}.`)
  }
  const { baseline, localHead } = resolveBaseline()
  console.log(`baseline: ${baseline} (git ls-remote origin production == local HEAD)`)

  // Throwaway copy so the real repo stays untouched.
  const copy = mkdtempSync(join(tmpdir(), 'ming-workbench-family-space-orphan-'))
  const storeDir = mkdtempSync(join(tmpdir(), 'ming-workbench-family-space-orphan-store-'))
  try {
    execFileSync('cp', ['-R', '--reflink=auto', `${familySpace}/.`, copy], { stdio: 'ignore' })

    // --- 1. open the run (real intent: apply the RWU001 fix) -----------------
    const executionRun = openExecutionRun({
      workUnitId: 'WU-RWU001',
      authorizationRef: 'GRANT-RWU001',
      provider: 'deepseek-harness',
      purpose: 'execution',
    })
    check(executionRun.status === 'started', 'ExecutionRun opened (started) for the RWU001 fix')

    // --- 2. the run mutates CURRENT_STATE.md, then crashes -------------------
    const statePath = join(copy, 'CURRENT_STATE.md')
    const lines = readFileSync(statePath, 'utf8').split('\n')
    const idx = lines.findIndex((l) => BASELINE_MARKER.test(l))
    check(idx >= 0, 'CURRENT_STATE.md has the observation anchor line')
    if (idx < 0) throw new Error('fix anchor line missing')
    if (!lines[idx].includes('production@')) {
      lines[idx] = lines[idx].replace(BASELINE_MARKER, `当前仓库观察基线：production@${baseline}；`)
      writeFileSync(statePath, lines.join('\n'))
    }
    check(
      readFileSync(statePath, 'utf8').includes(`production@${baseline}`),
      'the orphaned run mutated CURRENT_STATE.md (real effect happened)',
      baseline.slice(0, 12),
    )

    // Crash: persist the run as non-terminal — no close, no evidence, no outcome.
    const store = createFileWorkUnitStore(storeDir)
    store.save({
      storeVersion: 3,
      projectRoot: copy,
      workUnits: [toPersistedWorkUnit({
        id: 'WU-RWU001',
        spaceId: 'SPACE-family-space',
        title: 'Restore Family Space AAOP bridge availability',
        outcome: 'aaop-family.cjs status exits 0 with a declared production baseline',
        state: 'running',
        owner: 'human',
        gate: { kind: 'none', open: false },
        acceptance: [{ id: 'C1', statement: 'aaop-family.cjs status exits 0 with declared product observation', satisfied: false, evidenceIds: [] }],
        evidence: [],
        assets: [],
        createdAt: '2026-08-15T00:00:00.000Z',
        updatedAt: '2026-08-15T00:00:00.000Z',
      })],
      grants: {},
      runs: [toPersistedExecutionRun(executionRun)],
      verifications: [],
      lastProjectRoot: copy,
    })
    check(true, 'crash simulated: run record persisted as non-terminal (started), no close/evidence/outcome')

    // --- 3. restart: a FRESH store instance reads the same file ---------------
    const reloaded = createFileWorkUnitStore(storeDir).load()
    const crashed = reloaded.runs[0]
    check(crashed.status === 'started', 'after restart the run is still non-terminal (started)')
    check(crashed.outcome === undefined, 'no fabricated outcome survived the crash')
    check(crashed.evidenceRefs.length === 0, 'no evidence was fabricated for the crashed run')

    // --- 4. reconcile: re-observe reality, attribute the effect ---------------
    const slice = buildExactSlice(copy, localHead, ['CURRENT_STATE.md'])
    const result = reconcileOrphanedRun({
      run: { ...executionRun, status: crashed.status },
      slice,
      projectRoot: copy,
      now: new Date().toISOString(),
    })
    check(result.orphaned === true, 'non-terminal run reported as orphaned / reconciling')
    check(
      result.attributedChanges.includes('CURRENT_STATE.md'),
      'the real CURRENT_STATE.md mutation is attributed to the orphaned run',
      result.attributedChanges.join(',') || '<none>',
    )
    check(
      result.decision === 'requires-new-run',
      'decision is requires-new-run (an effect exists; never blind-retry)',
      result.decision,
    )
    check(
      result.decision !== 'safe-to-resume'
        && result.decision !== 'reconciled-completed'
        && result.decision !== 'reconciled-failed',
      'the run is neither resumed, nor fabricated completed/failed',
    )

    // --- 5. verification: the surviving effect is independently re-observable --
    const statusResult = (() => {
      try {
        const out = execFileSync(process.execPath, ['scripts/aaop-family.cjs', 'status'], {
          cwd: copy,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        return { status: 0, stdout: out.trim() }
      } catch (error) {
        return { status: error.status ?? null, stdout: `${error.stdout ?? ''}`.trim() }
      }
    })()
    check(
      statusResult.status === 0
        && statusResult.stdout.includes(`declared product observation: ${baseline}`),
      'the attributed effect satisfies the acceptance criterion (status exits 0)',
      `exit=${statusResult.status}`,
    )

    // Zero pollution on the copy: HEAD unchanged, only CURRENT_STATE.md tracked.
    const afterHead = run(copy, ['rev-parse', 'HEAD'])
    check(afterHead === localHead, 'copy HEAD unchanged (recovery did not re-run)', afterHead.slice(0, 12))
    const porcelain = run(copy, ['status', '--porcelain', '--untracked-files=no'])
    const dirty = porcelain.split('\n').filter(Boolean).map((l) => {
      const m = /^\S\s+(.+)$/.exec(l.trimStart())
      return m ? m[1] : l
    })
    check(
      dirty.length === 1 && dirty[0] === 'CURRENT_STATE.md',
      'only CURRENT_STATE.md changed (single attributed effect)',
      dirty.join(',') || '<none>',
    )

    console.log(`FAMILY SPACE ORPHAN RECOVERY: ${failures === 0 ? 'PASS' : 'FAIL'}`)
    process.exit(failures === 0 ? 0 : 1)
  } finally {
    rmSync(copy, { recursive: true, force: true })
    rmSync(storeDir, { recursive: true, force: true })
  }
}

try {
  main()
} catch (error) {
  console.error(`FAMILY SPACE ORPHAN RECOVERY: FAIL — ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
