#!/usr/bin/env node
/**
 * Real-project FIX regression smoke against the actual Family Space repo.
 *
 * Proves on a THROWAWAY COPY of the real YuemingHub/Family-Space clone that
 * the locked REAL WORK UNIT 001 fix spec is correct end-to-end:
 *
 *   1. at production HEAD the AAOP bridge `status` exits 2 (reproduces the
 *      real bug: CURRENT_STATE.md no longer declares `production@<40-hex-sha>`);
 *   2. after applying the exact single-line fix — declaring the verified
 *      baseline on the `当前仓库观察基线：` line — the same `status` command
 *      exits 0 and prints `declared product observation: <baseline>`;
 *   3. the real repo stays untouched (zero pollution): the copy's HEAD is
 *      unchanged and only CURRENT_STATE.md carries a tracked change.
 *
 * The verified baseline is auto-detected with `git ls-remote origin production`
 * (and cross-checked against the local clone HEAD) so the smoke never guesses
 * a SHA by hand — the same rule the real Workbench authorize/execute path uses.
 *
 * This smoke is the regression assertion that must stay green after a REAL
 * agent-driven fix: once DEEPSEEK_API_KEY is provided and the Workbench
 * authorize gate applies the fix to the real repo, this script re-asserts the
 * same contract on a fresh copy.
 *
 * Usage:
 *   node scripts/smoke-family-space-fix.mjs
 *   MING_FAMILY_SPACE_CHECKOUT=<path> node scripts/smoke-family-space-fix.mjs
 */

import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

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

async function main() {
  if (!existsSync(join(familySpace, 'CURRENT_STATE.md'))) {
    throw new Error(`Family Space checkout not found at ${familySpace}.`)
  }

  // --- verified baseline: auto-detect, never guessed ---
  let remoteHead = ''
  try {
    remoteHead = run(familySpace, ['ls-remote', 'origin', 'production']).split(/\s+/)[0] ?? ''
  } catch {
    // fall through: local HEAD cross-check below still applies
  }
  const localHead = run(familySpace, ['rev-parse', 'HEAD'])
  const baseline = remoteHead || localHead
  const baselineSource = remoteHead && remoteHead === localHead
    ? 'git ls-remote origin production == local HEAD'
    : remoteHead
      ? 'git ls-remote origin production'
      : 'local HEAD (origin ls-remote unavailable)'
  if (!/^[0-9a-f]{40}$/i.test(baseline)) {
    throw new Error(`could not resolve a 40-hex baseline SHA (remote='${remoteHead}', local='${localHead}')`)
  }
  console.log(`baseline: ${baseline} (${baselineSource})`)

  // --- throwaway copy: reproduce RED, apply the exact fix, assert GREEN ---
  const copy = mkdtempSync(join(tmpdir(), 'ming-workbench-family-space-fix-'))
  execFileSync('cp', ['-R', '--reflink=auto', `${familySpace}/.`, copy], { stdio: 'ignore' })

  // --- 1. reproduce the real bug on the copy at production HEAD ---
  const before = runNode(copy, ['scripts/aaop-family.cjs', 'status'])
  check(before.status === 2, 'copy reproduces the real bug: `status` exits 2', `exit=${before.status}`)
  check(
    before.stderr.includes('production@') || before.stderr.includes('CURRENT_STATE'),
    'the real failure is the missing `production@<40-hex-sha>` declaration',
  )

  // --- 2. apply the exact locked single-line fix ---
  const statePath = join(copy, 'CURRENT_STATE.md')
  const state = readFileSync(statePath, 'utf8').split('\n')
  const lineIndex = state.findIndex((line) => BASELINE_MARKER.test(line))
  check(lineIndex >= 0, 'CURRENT_STATE.md still has the `当前仓库观察基线：` line', lineIndex < 0 ? '<missing>' : '')
  if (lineIndex < 0) throw new Error('fix anchor line missing; aborting copy assertions')
  if (!state[lineIndex].includes('production@')) {
    state[lineIndex] = state[lineIndex].replace(
      BASELINE_MARKER,
      `当前仓库观察基线：production@${baseline}；`,
    )
    writeFileSync(statePath, state.join('\n'))
  }
  check(
    readFileSync(statePath, 'utf8').includes(`production@${baseline}`),
    'the fix declares the verified baseline on the observation line',
    baseline.slice(0, 12),
  )

  const after = runNode(copy, ['scripts/aaop-family.cjs', 'status'])
  check(after.status === 0, '`status` exits 0 after the fix', `exit=${after.status}`)
  check(
    after.stdout.includes(`declared product observation: ${baseline}`),
    '`status` prints the declared product observation',
    (after.stdout.match(/declared product observation: \S+/) ?? ['<none>'])[0],
  )
  check(
    after.stdout.includes('life-validation stage: S0'),
    'life-validation stage still reports S0 (no collateral behavior change)',
  )

  // --- 3. zero pollution: HEAD unchanged, only CURRENT_STATE.md touched ---
  const afterHead = run(copy, ['rev-parse', 'HEAD'])
  check(afterHead === localHead, 'the copy HEAD is unchanged (fix is a working-tree delta)', afterHead.slice(0, 12))
  const porcelain = run(copy, ['status', '--porcelain', '--untracked-files=no'])
  const dirtyFiles = porcelain.split('\n').filter(Boolean).map((l) => {
    const m = /^\S\s+(.+)$/.exec(l.trimStart())
    return m ? m[1] : l
  })
  check(
    dirtyFiles.length === 1 && dirtyFiles[0] === 'CURRENT_STATE.md',
    'only CURRENT_STATE.md carries a tracked change',
    dirtyFiles.join(',') || '<none>',
  )

  rmSync(copy, { recursive: true, force: true })

  console.log(`FAMILY SPACE FIX REGRESSION RESULT: ${failures === 0 ? 'PASS' : 'FAIL'}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(`FAMILY SPACE FIX REGRESSION RESULT: FAIL — ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
