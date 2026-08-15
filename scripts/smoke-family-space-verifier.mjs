#!/usr/bin/env node
/**
 * P1-4 real-project Independent Verification smoke against Family Space.
 *
 * Proves the Independent Verifier architecture on a REAL project (RWU001: the
 * Family Space AAOP bridge `status` breaks because CURRENT_STATE.md lost its
 * `production@<40-hex-sha>` declaration).
 *
 * The verifier NEVER reads an executor's natural-language conclusion, "done",
 * test claim, or self-summary. It independently re-observes reality:
 *
 *   1. runs `scripts/aaop-family.cjs status` itself and reads the real exit
 *      code (the product's own deterministic bridge);
 *   2. reads CURRENT_STATE.md itself and checks the `production@` declaration
 *      against the auto-verified baseline (`git ls-remote origin production`
 *      cross-checked with local HEAD);
 *   3. applies the locked single-line fix on a THROWAWAY COPY and re-observes
 *      that `status` exits 0 — the independent observation that the fix meets
 *      the acceptance criterion;
 *   4. emits a first-class Verification object (verdict + evidence refs + the
 *      independent observations) as the Workbench Evidence Spine would.
 *
 * No DEEPSEEK_API_KEY is needed: this validates the Verifier ARCHITECTURE on a
 * real repository, not provider intelligence.
 *
 * Usage:
 *   node scripts/smoke-family-space-verifier.mjs
 *   MING_FAMILY_SPACE_CHECKOUT=<path> node scripts/smoke-family-space-verifier.mjs
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

import { buildExactSlice } from '../.tmp/execution/mutation-slice.js'
import { runDeterministicVerification } from '../.tmp/execution/verification.js'
import { toPersistedVerification, fromPersistedVerification } from '../.tmp/persistence/work-unit-store.js'

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

function run(cwd, args, env = {}) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
  }).trim()
}

function runNode(cwd, args) {
  try {
    const result = execFileSync(process.execPath, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, stdout: result.trim(), stderr: '' }
  } catch (error) {
    return {
      status: error.status ?? null,
      stdout: `${error.stdout ?? ''}`.trim(),
      stderr: `${error.stderr ?? ''}`.trim(),
    }
  }
}

/** The verified production baseline, never guessed. */
function resolveBaseline() {
  let remoteHead = ''
  try {
    remoteHead = run(familySpace, ['ls-remote', 'origin', 'production']).split(/\s+/)[0] ?? ''
  } catch {
    // fall through: local HEAD cross-check below still applies
  }
  const localHead = run(familySpace, ['rev-parse', 'HEAD'])
  const baseline = remoteHead || localHead
  const source = remoteHead && remoteHead === localHead
    ? 'git ls-remote origin production == local HEAD'
    : remoteHead ? 'git ls-remote origin production' : 'local HEAD'
  if (!/^[0-9a-f]{40}$/i.test(baseline)) {
    throw new Error(`could not resolve a 40-hex baseline SHA (remote='${remoteHead}', local='${localHead}')`)
  }
  return { baseline, source, localHead }
}

/**
 * Deterministic probe: run the REAL product bridge on a copy and read the exit
 * code — the verifier's own independent reality observation. Never consults an
 * executor's summary.
 */
function runBridgeProbe(copyDir) {
  const result = runNode(copyDir, ['scripts/aaop-family.cjs', 'status'])
  return {
    exitCode: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

function main() {
  if (!existsSync(join(familySpace, 'CURRENT_STATE.md'))) {
    throw new Error(`Family Space checkout not found at ${familySpace}.`)
  }

  const { baseline, source, localHead } = resolveBaseline()
  console.log(`baseline: ${baseline} (${source})`)

  // The verifier's subject is the RWU001 fix Work Unit. It knows the intent and
  // the acceptance criterion; it does not inherit any executor conclusion.
  const subjectRunId = `RUN-RWU001-executor`
  const workUnit = {
    id: 'WU-RWU001',
    spaceId: 'SPACE-family-space',
    title: 'Restore Family Space AAOP bridge availability',
    outcome: 'aaop-family.cjs status exits 0 with a declared production baseline',
    state: 'verifying',
    owner: 'human',
    gate: { kind: 'none', open: false },
    acceptance: [
      { id: 'C1', statement: 'aaop-family.cjs status exits 0 with declared product observation', satisfied: false, evidenceIds: [] },
    ],
    evidence: [],
    assets: [],
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
  }

  // --- Verifier observation 1: read the real CURRENT_STATE.md itself ---------
  const stateText = readFileSync(join(familySpace, 'CURRENT_STATE.md'), 'utf8')
  check(
    !/production@[0-9a-f]{40}/i.test(stateText),
    'reality observation: production HEAD lacks the `production@<sha>` declaration (RWU001 reproduces)',
  )

  // --- Verifier observation 2: run the real bridge on the untouched clone ----
  const untouched = runBridgeProbe(familySpace)
  check(
    untouched.exitCode === 2,
    'verifier independently runs `aaop-family.cjs status` on the real repo',
    `exit=${untouched.exitCode}`,
  )

  // --- Verifier observation 3: apply the fix on a THROWAWAY copy and re-observe
  // The verifier is still independent: it performs the observation, not the
  // product's acceptance. This is the deterministic reality check for the
  // acceptance criterion.
  const copy = mkdtempSync(join(tmpdir(), 'ming-workbench-family-space-verifier-'))
  try {
    execFileSync('cp', ['-R', '--reflink=auto', `${familySpace}/.`, copy], { stdio: 'ignore' })

    const statePath = join(copy, 'CURRENT_STATE.md')
    const lines = readFileSync(statePath, 'utf8').split('\n')
    const idx = lines.findIndex((l) => BASELINE_MARKER.test(l))
    if (idx >= 0 && !lines[idx].includes('production@')) {
      lines[idx] = lines[idx].replace(BASELINE_MARKER, `当前仓库观察基线：production@${baseline}；`)
      writeFileSync(statePath, lines.join('\n'))
    }

    const fixed = runBridgeProbe(copy)
    check(
      fixed.exitCode === 0,
      'verifier re-observes the fixed copy: `status` exits 0',
      `exit=${fixed.exitCode}`,
    )
    check(
      fixed.stdout.includes(`declared product observation: ${baseline}`),
      'verifier observes the declared product observation matches the verified baseline',
      (fixed.stdout.match(/declared product observation: \S+/) ?? ['<none>'])[0],
    )
    check(
      fixed.stdout.includes('life-validation stage: S0'),
      'verifier observes no collateral behavior change (S0 preserved)',
    )

    // Zero-pollution observation: HEAD unchanged, only CURRENT_STATE.md tracked.
    const afterHead = run(copy, ['rev-parse', 'HEAD'])
    check(afterHead === localHead, 'verifier observes the fix is a working-tree delta (HEAD unchanged)', afterHead.slice(0, 12))
    const porcelain = run(copy, ['status', '--porcelain', '--untracked-files=no'])
    const dirty = porcelain.split('\n').filter(Boolean).map((l) => {
      const m = /^\S\s+(.+)$/.exec(l.trimStart())
      return m ? m[1] : l
    })
    check(
      dirty.length === 1 && dirty[0] === 'CURRENT_STATE.md',
      'verifier observes only CURRENT_STATE.md changed',
      dirty.join(',') || '<none>',
    )

    // --- Emit the first-class Verification through the Evidence Spine --------
    // The verifier is a NEW ExecutionRun with purpose='verification'. It
    // independently observed reality (exit codes + file content), never the
    // executor's words.
    const slice = buildExactSlice(copy, afterHead, ['CURRENT_STATE.md'])
    const verification = runDeterministicVerification({
      workUnit,
      criterion: workUnit.acceptance[0],
      slice,
      subjectRun: { id: subjectRunId },
      projectRoot: copy,
      probes: [
        { kind: 'file-exists', path: 'CURRENT_STATE.md' },
      ],
      now: new Date().toISOString(),
    })
    const realObservation = `aaop-family.cjs status exit ${untouched.exitCode} -> ${fixed.exitCode}; declared ${baseline}`
    const verificationRecord = {
      ...verification.verification,
      verifierRunId: `RUN-RWU001-verifier`,
      observations: [realObservation, ...verification.verification.observations],
    }

    check(
      verificationRecord.verdict === 'passed',
      'Independent Verifier emits a passed verdict from its own reality observations',
      verificationRecord.verdict,
    )
    check(
      verificationRecord.subjectRunId === subjectRunId,
      'Verification links subjectRun (executor) to verifierRun (verifier)',
      `${verificationRecord.subjectRunId} -> ${verificationRecord.verifierRunId}`,
    )

    // Durable round-trip (restart provenance) of the Verification object.
    const persisted = toPersistedVerification(verificationRecord)
    const restored = fromPersistedVerification(persisted)
    check(
      restored.id === verificationRecord.id
        && restored.workUnitId === 'WU-RWU001'
        && restored.verdict === 'passed',
      'Verification survives the durable store round-trip (restart provenance)',
      restored.id,
    )

    console.log(`FAMILY SPACE INDEPENDENT VERIFICATION: ${failures === 0 ? 'PASS' : 'FAIL'}`)
    process.exit(failures === 0 ? 0 : 1)
  } finally {
    rmSync(copy, { recursive: true, force: true })
  }
}

try {
  main()
} catch (error) {
  console.error(`FAMILY SPACE INDEPENDENT VERIFICATION: FAIL — ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
