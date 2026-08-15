#!/usr/bin/env node
/**
 * Real-project Workbench grounding smoke against the actual Family Space repo.
 *
 * Proves on the REAL YuemingHub/Family-Space clone (not an ephemeral scratch
 * repo) that the Ming Workbench product chain:
 *
 *   1. recognizes the real project through a workbench.project.json bridge;
 *   2. reads back REAL current reality: Family Space's own AAOP bridge is
 *      currently broken at production HEAD (CURRENT_STATE.md no longer declares
 *      `production@<40-hex-sha>`, so `scripts/aaop-family.cjs status` exits 2);
 *   3. refuses to fabricate progress: read-only Intake returns "blocked" and
 *      surfaces that exact real reason (bridge not ready) instead of inventing
 *      a grounded Work Unit;
 *   4. still persists the blocked Work Unit so a human can resume it;
 *   5. freezes an exact file surface on authorize (real repo/branch/base);
 *   6. refuses execution without a model provider credential (402).
 *
 * This smoke is provider-free on purpose: the Family Space AAOP bridge blocks
 * before the Harness coordinator is reached, and execute must fail-closed with
 * `provider-required` when DEEPSEEK_API_KEY is absent. The remaining blocker
 * for a REAL agent-driven fix is therefore a real provider credential, which
 * this smoke does not fabricate.
 *
 * Usage:
 *   node scripts/smoke-family-space.mjs
 *   MING_FAMILY_SPACE_CHECKOUT=<path> node scripts/smoke-family-space.mjs
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

const workbenchRoot = resolve(process.cwd())
const familySpace = resolve(
  process.env.MING_FAMILY_SPACE_CHECKOUT ?? join(workbenchRoot, '.workbench', 'projects', 'family-space'),
)
const harnessCheckout = resolve(
  process.env.MING_HARNESS_CHECKOUT ?? join(workbenchRoot, '.workbench', 'vendor', 'deepseek-harness'),
)

const BRIDGE_FILE = 'workbench.project.json'
// The real Family Space AAOP bridge commands. `ready`/`status` both run the
// repo's own contract validation; at production HEAD this fails because
// CURRENT_STATE.md no longer declares `production@<40-hex-sha>`.
const BRIDGE_CMD = ['scripts/aaop-family.cjs']

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
  const result = execFileSync(process.execPath, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return result.trim()
}

function httpJson(url, { method = 'GET', token, body, timeoutMs = 30_000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  return fetch(url, {
    method,
    headers: {
      ...(token ? { 'x-ming-workbench-token': token } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: controller.signal,
  }).finally(() => clearTimeout(timer))
}

function waitForLine(stream, predicate, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error('timed out waiting for process output')), timeoutMs)
    const onData = (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const match = predicate(line)
        if (match) {
          clearTimeout(timer)
          stream.off('data', onData)
          resolvePromise(match)
          return
        }
      }
    }
    stream.on('data', onData)
  })
}

async function main() {
  if (!existsSync(join(familySpace, 'AGENTS.md'))) {
    throw new Error(`Family Space checkout not found at ${familySpace}. Clone YuemingHub/Family-Space first.`)
  }
  if (!existsSync(harnessCheckout)) {
    throw new Error(`reviewed Harness checkout not found at ${harnessCheckout}. Run npm run harness:prepare first.`)
  }

  const baselineHead = run(familySpace, ['rev-parse', 'HEAD'])
  const baselineBranch = run(familySpace, ['branch', '--show-current'])
  console.log(`family-space: ${familySpace}`)
  console.log(`  git: ${baselineBranch} @ ${baselineHead.slice(0, 12)}`)

  // --- 1. REAL reality readback: Family Space's own AAOP bridge is broken. ---
  let statusExit = null
  let statusStderr = ''
  try {
    execFileSync(process.execPath, [...BRIDGE_CMD, 'status'], {
      cwd: familySpace,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    statusExit = 0
  } catch (error) {
    statusExit = error.status ?? null
    statusStderr = `${error.stderr ?? ''}${error.stdout ?? ''}`
  }
  check(statusExit === 2, 'real Family Space AAOP bridge `status` fails at production HEAD', `exit=${statusExit}`)
  check(
    statusStderr.includes('production@') || statusStderr.includes('CURRENT_STATE'),
    'the real failure is the missing `production@<40-hex-sha>` declaration in CURRENT_STATE.md',
  )

  // --- 2. bridge manifest: the Workbench recognizes the real project. ---
  const bridge = {
    schema_version: '1.0',
    project: { id: 'family-space', title: 'Family Space', domain_pack: 'development-aaop' },
    development: {
      aaop_bridge: {
        ready: { command: 'node', args: [...BRIDGE_CMD, 'ready'] },
        status: { command: 'node', args: [...BRIDGE_CMD, 'status'] },
        prompt: { command: 'node', args: [...BRIDGE_CMD, 'prompt'] },
      },
    },
  }
  const bridgePath = join(familySpace, BRIDGE_FILE)
  writeFileSync(bridgePath, JSON.stringify(bridge, null, 2) + '\n')

  const storeDir = mkdtempSync(join(tmpdir(), 'ming-workbench-family-space-store-'))
  const sessionRoot = mkdtempSync(join(tmpdir(), 'ming-workbench-family-space-sessions-'))

  const backend = spawn(
    process.execPath,
    ['scripts/start-local-web.mjs',
      '--project', familySpace,
      '--workbench-root', workbenchRoot,
      '--harness-checkout', harnessCheckout,
      '--store-dir', storeDir,
      '--port', '0',
    ],
    {
      cwd: workbenchRoot,
      // Deliberately NO DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL: this smoke proves
      // the provider gate fail-closed, not a mock execution.
      env: { ...process.env, MING_WORKBENCH_SESSION_ROOT: sessionRoot },
      stdio: ['ignore', 'pipe', 'inherit'],
      windowsHide: true,
    },
  )
  const readyLine = await waitForLine(backend.stdout, (line) => {
    const m = /^MING_WORKBENCH_READY (http:\/\/127\.0\.0\.1:\d+)$/.exec(line)
    return m ? m[1] : null
  }, 60_000)
  console.log(`backend ready: ${readyLine}`)

  try {
    const page = await (await httpJson(`${readyLine}/`)).text()
    const token = /ming-workbench-token" content="([^"]+)"/.exec(page)?.[1] ?? ''
    check(Boolean(token), 'served page carries the per-process request token')

    // --- 3. onboarding recognizes the real project via the bridge manifest. ---
    const project = await (await httpJson(`${readyLine}/api/project`, { token })).json()
    check(project.status === 'ready', 'onboarding resolves Family Space as ready via workbench.project.json', `status=${project.status}`)
    check(project.project?.id === 'family-space', 'onboarding reports the real Family Space project id', project.project?.id ?? '<none>')

    // --- 4. read-only Intake grounds the request and surfaces the REAL blocker. ---
    const request = '让 Family Space 的 AAOP 本地接入恢复正常：脚本能通过 status 就绪检查。'
    const intake = await httpJson(`${readyLine}/api/intake`, {
      method: 'POST', token, body: { request }, timeoutMs: 120_000,
    })
    const intakeBody = await intake.json()
    check(intake.status === 200, 'POST /api/intake returns a grounded (blocked) result', `status=${intake.status}`)
    check(intakeBody?.status === 'blocked', 'intake does NOT fabricate progress: returns blocked', intakeBody?.status ?? '<none>')
    check(
      typeof intakeBody?.blocker === 'string' && intakeBody.blocker.includes('CURRENT_STATE'),
      'blocker names the real Family Space AAOP bridge failure',
      (intakeBody?.blocker ?? '').slice(0, 90),
    )
    const workUnitId = intakeBody?.workUnit?.id
    check(typeof workUnitId === 'string' && workUnitId.length > 0, 'intake still returns a Work Unit id', workUnitId ?? '<none>')

    // --- 5. the blocked Work Unit is persisted for later human resume. ---
    const listed = await (await httpJson(`${readyLine}/api/workunits`, { token })).json()
    check(
      Array.isArray(listed.workUnits) && listed.workUnits.some((w) => w.id === workUnitId),
      'blocked Work Unit persisted in the backend store for resume',
    )

    // --- 6. authorize freezes a real exact file surface. ---
    const auth = await httpJson(`${readyLine}/api/authorize`, {
      method: 'POST', token, body: { workUnitId, authorize: true, filePaths: ['CURRENT_STATE.md'] }, timeoutMs: 60_000,
    })
    const authBody = await auth.json()
    check(auth.status === 200, 'authorize issues a backend-owned grant on the real repo', `status=${auth.status}`)
    check(
      authBody?.slice?.scopeLabel === 'exact(1 path)' && (authBody?.slice?.paths ?? []).join(',') === 'CURRENT_STATE.md',
      'authorize freezes the exact authorized file surface',
      authBody?.slice?.scopeLabel ?? '<none>',
    )
    check(
      authBody?.writeTarget?.repository === familySpace && authBody?.writeTarget?.base_ref === baselineHead && authBody?.writeTarget?.working_ref === baselineBranch,
      'grant binds to the real Family Space repository/branch/base',
    )

    // --- 7. execute fail-closes without a model provider credential. ---
    const exec = await httpJson(`${readyLine}/api/execute`, {
      method: 'POST', token, body: { workUnitId }, timeoutMs: 60_000,
    })
    const execBody = await exec.json()
    check(exec.status === 402, 'execute without a provider credential is rejected', `status=${exec.status}`)
    check(execBody?.status === 'provider-required', 'execute reports provider-required (the one remaining human blocker)', execBody?.status ?? '<none>')

    // --- 8. reality readback again: no mutation was made to the real repo. ---
    const afterHead = run(familySpace, ['rev-parse', 'HEAD'])
    check(afterHead === baselineHead, 'the real Family Space HEAD is unchanged (no unauthorized mutation)', afterHead.slice(0, 12))
  } finally {
    if (backend.exitCode === null) {
      backend.kill('SIGTERM')
      await new Promise((r) => backend.once('exit', r))
    }
    rmSync(bridgePath, { force: true })
  }

  console.log(`FAMILY SPACE GROUNDING RESULT: ${failures === 0 ? 'PASS' : 'FAIL'}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(`FAMILY SPACE GROUNDING RESULT: FAIL — ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
