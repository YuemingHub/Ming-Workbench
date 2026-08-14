#!/usr/bin/env node
/**
 * Real bounded scratch mutation through the full Ming Workbench product chain.
 *
 * Proves on an EPHEMERAL scratch Git repository (never a real project):
 *
 *   ordinary-language request
 *     -> POST /api/intake (real AAOP Intake via reviewed Harness ACP read-only)
 *     -> persisted Work Unit in the backend store
 *     -> POST /api/authorize (explicit human authorization intent only)
 *     -> backend-owned Provider Execution Grant
 *     -> POST /api/execute (fresh mutable-facts re-check)
 *     -> real reviewed Harness ACP session against the OFFICIAL mock LLM seam
 *     -> real file mutation through the Harness tool layer
 *     -> Git before/after delta + repository/test evidence
 *     -> Work Unit completion
 *
 * Then resume/stale-authority pressure on the SAME Work Unit:
 *
 *   -> backend restart
 *     -> same Work Unit identity restored from the persisted store
 *     -> scratch repo HEAD mutated while the app was down
 *     -> /api/resume reports factsChanged
 *     -> old grant must NOT execute (409 stale-authority)
 *     -> re-authorize binds to the newly observed facts and executes
 *
 * The only fake is the model: the reviewed Harness ships
 * packages/test-support/llm-mock-server (OpenAI-compatible). Everything else —
 * Harness agent loop, tools, sandbox, git, backend, store — is real.
 *
 * MING_WORKBENCH_ALLOW_WRITE=1 is set ONLY for this ephemeral scratch process.
 * The product default stays off.
 *
 * Usage:
 *   node scripts/smoke-desktop-scratch-mutation.mjs
 *   MING_HARNESS_CHECKOUT=<path> node scripts/smoke-desktop-scratch-mutation.mjs
 */

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'

const workbenchRoot = resolve(process.cwd())
const harnessCheckout = resolve(
  process.env.MING_HARNESS_CHECKOUT ?? join(workbenchRoot, '.workbench', 'vendor', 'deepseek-harness'),
)

const SENTINEL_FILE = 'app.js'
const SENTINEL_MARKER = 'WORKBENCH_SCRATCH_MUTATION_OK'
// The intake coordinator requires the envelope raw_request to match the
// ordinary-language request verbatim, so both share one constant.
const INTAKE_REQUEST = `让 ${SENTINEL_FILE} 的测试通过：把 ${SENTINEL_FILE} 的返回值改成包含 ${SENTINEL_MARKER} 的标记，并保持其它文件不变。`
const MOCK_PORT = 8123
const MOCK_KEY = 'mock-key'
const MOCK_BASE_URL = `http://127.0.0.1:${MOCK_PORT}/v1`

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
  if (!existsSync(harnessCheckout)) {
    throw new Error(`reviewed Harness checkout not found at ${harnessCheckout}. Run npm run harness:prepare first.`)
  }
  const tsxCli = join(harnessCheckout, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const mockBin = join(harnessCheckout, 'packages', 'test-support', 'llm-mock-server', 'src', 'bin.ts')
  if (!existsSync(tsxCli) || !existsSync(mockBin)) {
    throw new Error('reviewed Harness deps are not installed in the checkout')
  }

  const scratch = mkdtempSync(join(tmpdir(), 'ming-workbench-scratch-mutation-'))
  // Store/session roots live OUTSIDE the scratch repo so the repo stays clean
  // before execution (the store must never count as execution evidence).
  const storeDir = mkdtempSync(join(tmpdir(), 'ming-workbench-store-'))
  const sessionRoot = mkdtempSync(join(tmpdir(), 'ming-workbench-sessions-'))

  console.log(`scratch repo: ${scratch}`)
  console.log(`harness checkout: ${harnessCheckout}`)

  // --- ephemeral scratch Git repository with a small program + failing test ---
  // An explicit workbench.project.json bridge marks the project ready (the
  // supported path for projects that already have AAOP); the real AAOP
  // bootstrap path is covered by the aaop-setup smoke.
  run(scratch, ['init', '-b', 'main'])
  run(scratch, ['config', 'user.email', 'smoke@local.test'])
  run(scratch, ['config', 'user.name', 'Scratch Mutation Smoke'])
  writeFileSync(join(scratch, 'README.md'), '# scratch mutation target\n')
  writeFileSync(join(scratch, 'bridge-ready.cjs'), 'process.exit(0)\n')
  writeFileSync(join(scratch, 'workbench.project.json'), JSON.stringify({
    schema_version: '1.0',
    project: {
      id: 'scratch-mutation',
      title: 'Scratch Mutation Target',
      domain_pack: 'development-aaop',
    },
    development: {
      aaop_bridge: {
        ready: { command: 'node', args: ['bridge-ready.cjs'] },
        status: { command: 'node', args: ['bridge-ready.cjs'] },
        prompt: { command: 'node', args: ['bridge-ready.cjs'] },
      },
    },
  }, null, 2) + '\n')
  writeFileSync(join(scratch, 'package.json'), JSON.stringify({
    name: 'scratch-mutation-target',
    private: true,
    scripts: { test: 'node --test' },
  }, null, 2) + '\n')
  // Small program + FAILING test: app.js does not exist yet, so the test fails
  // (module not found); the granted write CREATES app.js with the marker and
  // the project test then passes. (The reviewed Harness fs observation policy
  // requires reading an existing file before overwriting it — the CI write
  // smoke likewise creates a new file.)
  writeFileSync(join(scratch, 'app.test.mjs'),
    'import { test } from "node:test"\n'
    + 'import assert from "node:assert/strict"\n'
    + 'import app from "./app.js"\n'
    + 'test("greeting returns the reviewed marker", () => {\n'
    + `  assert.equal(app(), "${SENTINEL_MARKER}")\n`
    + '})\n')
  run(scratch, ['add', '.'])
  run(scratch, ['commit', '-m', 'init'])
  const baselineHead = run(scratch, ['rev-parse', 'HEAD'])
  const baselineBranch = run(scratch, ['branch', '--show-current'])

  // --- official reviewed-Harness mock LLM ---
  // Request order: intake (1), execute turn1 (2), execute turn2 (3),
  // re-execute turn1 (4), re-execute turn2 (5).
  // The intake response must be a parseable AAOP Intake Envelope (the real
  // coordinator requires exactly one JSON object with no surrounding prose);
  // the same text doubles as the execute sessions' final assistant message.
  const intakeEnvelopeJson = JSON.stringify({
    schema_version: '1.0',
    generated_at: new Date().toISOString(),
    raw_request: INTAKE_REQUEST,
    situation: 'defect_failure',
    route: 'bug-fix',
    route_confidence: 0.9,
    ambiguities: [],
    question_needed: null,
    project_evidence_summary: ['app.test.mjs asserts the WORKBENCH marker'],
    next_action: 'Apply the granted mutation and verify the project test passes.',
  })
  const mock = spawn(
    process.execPath,
    [tsxCli, '--tsconfig', join(harnessCheckout, 'tsconfig.json'), mockBin,
      '--port', String(MOCK_PORT),
      '--api-key', MOCK_KEY,
      '--sequence', 'success,tool_call_success,success,tool_call_success,success',
      '--repeat-last',
      '--tool-name', 'write',
      '--tool-arguments', JSON.stringify({
        file_path: 'app.js',
        content: `module.exports = () => "${SENTINEL_MARKER}"\n`,
      }),
      '--success-text', intakeEnvelopeJson,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true },
  )
  const children = [mock]
  const track = (child) => { children.push(child); return child }
  const mockLogPath = join(scratch, '..', `mock-requests-${Date.now()}.jsonl`)
  const mockLog = await import('node:fs').then((fs) => fs.createWriteStream(mockLogPath))
  mock.stdout.on('data', (chunk) => mockLog.write(chunk))
  const mockReady = await waitForLine(mock.stdout, (line) => (line.includes('"type":"ready"') ? line : null), 60_000)
  console.log(`mock LLM ready: ${mockReady}`)

  // --- real Workbench backend (dev mode, real store, real harness) ---
  const backend = track(spawn(
    process.execPath,
    ['scripts/start-local-web.mjs',
      '--project', scratch,
      '--workbench-root', workbenchRoot,
      '--harness-checkout', harnessCheckout,
      '--store-dir', storeDir,
      '--port', '0',
    ],
    {
      cwd: workbenchRoot,
      env: {
        ...process.env,
        DEEPSEEK_API_KEY: MOCK_KEY,
        DEEPSEEK_BASE_URL: MOCK_BASE_URL,
        MING_HARNESS_PROVIDER: 'deepseek-official',
        MING_HARNESS_MODEL: 'deepseek-v4-pro',
        MING_WORKBENCH_SESSION_ROOT: sessionRoot,
        // Scoped to this ephemeral scratch process only. Product default is off.
        MING_WORKBENCH_ALLOW_WRITE: '1',
      },
      stdio: ['ignore', 'pipe', 'inherit'],
      windowsHide: true,
    },
  ))
  const readyLine = await waitForLine(backend.stdout, (line) => {
    const m = /^MING_WORKBENCH_READY (http:\/\/127\.0\.0\.1:\d+)$/.exec(line)
    return m ? m[1] : null
  }, 60_000)
  console.log(`backend ready: ${readyLine}`)

  async function stopBackend() {
    if (backend.exitCode === null) {
      const p = backend
      backend.kill('SIGTERM')
      await new Promise((r) => p.once('exit', r))
    }
  }

  try {
    // --- token from the served page meta (same as the renderer) ---
    const page = await httpJson(`${readyLine}/`)
    const html = await page.text()
    const tokenMatch = /ming-workbench-token" content="([^"]+)"/.exec(html)
    check(tokenMatch, 'served page carries the per-process request token')
    const token = tokenMatch?.[1] ?? ''

    // --- phase 1: intake -> persisted Work Unit ---
    const intake = await httpJson(`${readyLine}/api/intake`, {
      method: 'POST',
      token,
      body: { request: INTAKE_REQUEST },
      timeoutMs: 180_000,
    })
    const intakeBody = await intake.json()
    check(intake.status === 200, 'POST /api/intake returns 200', `status=${intake.status}`)
    const workUnitId = intakeBody?.workUnit?.id
    check(typeof workUnitId === 'string' && workUnitId.length > 0, 'intake returns a Work Unit id', `id=${workUnitId ?? '<none>'}`)

    const listed = await (await httpJson(`${readyLine}/api/workunits`, { token })).json()
    check(
      Array.isArray(listed.workUnits) && listed.workUnits.some((w) => w.id === workUnitId),
      'Work Unit persisted in the backend store',
      `count=${listed.workUnits?.length ?? '<none>'}`,
    )

    // --- authorization gate: execute before authorize must fail ---
    const premature = await httpJson(`${readyLine}/api/execute`, {
      method: 'POST', token, body: { workUnitId }, timeoutMs: 60_000,
    })
    check(premature.status === 400, 'execute before authorize is rejected', `status=${premature.status}`)

    // --- explicit human authorization -> backend-owned grant ---
    // P0-1: the grant boundary is the exact human-confirmed file surface.
    // There is no default scope; the human confirms the grounded surface here.
    const auth = await httpJson(`${readyLine}/api/authorize`, {
      method: 'POST', token, body: { workUnitId, authorize: true, filePaths: [SENTINEL_FILE] }, timeoutMs: 60_000,
    })
    const authBody = await auth.json()
    check(auth.status === 200, 'POST /api/authorize issues a backend-owned grant', `status=${auth.status}`)
    check(typeof authBody?.grantId === 'string', 'authorize returns a grantId', `grant=${authBody?.grantId ?? '<none>'}`)
    check(
      authBody?.slice?.scopeLabel === 'exact(1 path)' && (authBody?.slice?.paths ?? []).join(',') === SENTINEL_FILE,
      'authorize freezes the exact authorized file surface',
      `scope=${authBody?.slice?.scopeLabel ?? '<none>'}`,
    )
    check(
      authBody?.writeTarget?.repository === scratch && authBody?.writeTarget?.base_ref === baselineHead && authBody?.writeTarget?.working_ref === baselineBranch,
      'grant binds to the exact scratch repository/branch/base',
      `base=${authBody?.writeTarget?.base_ref ?? '<none>'}`,
    )

    // --- before/after Git evidence ---
    const beforeDirty = run(scratch, ['status', '--porcelain'])
    check(beforeDirty === '', 'scratch repo clean before execution', beforeDirty || 'clean')

    // --- real bounded execution through the reviewed Harness + mock LLM ---
    const execStart = Date.now()
    const exec = await httpJson(`${readyLine}/api/execute`, {
      method: 'POST', token, body: { workUnitId }, timeoutMs: 300_000,
    })
    const execBody = await exec.json()
    check(exec.status === 200, 'POST /api/execute completes', `status=${exec.status} in ${((Date.now() - execStart) / 1000).toFixed(1)}s`)

    const afterHead = run(scratch, ['rev-parse', 'HEAD'])
    const afterDirty = run(scratch, ['status', '--porcelain']).split(/\r?\n/).filter(Boolean)
    const changed = afterDirty.map((line) => line.slice(3))
    check(afterHead === baselineHead, 'execution does not move HEAD (no commit made by Harness)', afterHead.slice(0, 8))
    check(changed.includes(SENTINEL_FILE), 'Git after-status shows the granted file mutation', changed.join(', '))
    check(
      readFileSync(join(scratch, SENTINEL_FILE), 'utf8').includes(SENTINEL_MARKER),
      'mutation content reached the real file',
    )
    check(execBody?.workUnit?.state === 'verifying', 'Work Unit advances to verifying with evidence', execBody?.workUnit?.state ?? '<none>')
    const evidence = execBody?.workUnit?.evidence ?? []
    check(evidence.length > 0, 'evidence-backed Work Unit returned', `${evidence.length} evidence items`)
    check(
      evidence.some((e) => e.kind === 'repository' && e.summary.includes('Changes produced by this execution: 1')),
      'repository evidence names exactly the execution-produced file',
    )
    check(
      evidence.some((e) => e.kind === 'test' && e.summary.includes('tests passed')),
      'authoritative test evidence shows the project tests passed',
    )

    // --- phase 2: resume/stale-authority pressure on the same Work Unit ---
    await stopBackend()

    // Mutate scratch repo HEAD while the app is down.
    writeFileSync(join(scratch, 'README.md'), '# scratch mutation target\n# changed while app was down\n')
    run(scratch, ['add', 'README.md'])
    run(scratch, ['commit', '-m', 'external change while app was down'])

    const backend2 = track(spawn(
      process.execPath,
      ['scripts/start-local-web.mjs',
        '--project', scratch,
        '--workbench-root', workbenchRoot,
        '--harness-checkout', harnessCheckout,
        '--store-dir', storeDir,
        '--port', '0',
      ],
      {
        cwd: workbenchRoot,
        env: {
          ...process.env,
          DEEPSEEK_API_KEY: MOCK_KEY,
          DEEPSEEK_BASE_URL: MOCK_BASE_URL,
          MING_HARNESS_PROVIDER: 'deepseek-official',
          MING_HARNESS_MODEL: 'deepseek-v4-pro',
          MING_WORKBENCH_SESSION_ROOT: sessionRoot,
          MING_WORKBENCH_ALLOW_WRITE: '1',
        },
        stdio: ['ignore', 'pipe', 'inherit'],
        windowsHide: true,
      },
    ))
    const ready2 = await waitForLine(backend2.stdout, (line) => {
      const m = /^MING_WORKBENCH_READY (http:\/\/127\.0\.0\.1:\d+)$/.exec(line)
      return m ? m[1] : null
    }, 60_000)
    console.log(`backend restarted: ${ready2}`)
    const page2 = await (await httpJson(`${ready2}/`)).text()
    const token2 = /ming-workbench-token" content="([^"]+)"/.exec(page2)?.[1] ?? ''

    const listed2 = await (await httpJson(`${ready2}/api/workunits`, { token: token2 })).json()
    check(
      listed2.workUnits.some((w) => w.id === workUnitId),
      'same Work Unit identity restored after backend restart',
    )
    check(listed2.hasStoredGrant === true, 'stored grant still present after restart')

    const resume = await (await httpJson(`${ready2}/api/resume`, {
      method: 'POST', token: token2, body: { workUnitId }, timeoutMs: 60_000,
    })).json()
    check(resume.factsChanged === true, '/api/resume reports factsChanged after external HEAD mutation', `factsChanged=${resume.factsChanged}`)

    const staleExec = await httpJson(`${ready2}/api/execute`, {
      method: 'POST', token: token2, body: { workUnitId }, timeoutMs: 60_000,
    })
    const staleBody = await staleExec.json()
    check(staleExec.status === 409, 'old grant cannot execute against changed facts', `status=${staleExec.status} ${staleBody?.status ?? ''}`)

    // Re-authorize binds to the NEW facts; the fresh grant executes.
    const reAuth = await (await httpJson(`${ready2}/api/authorize`, {
      method: 'POST', token: token2, body: { workUnitId, authorize: true, filePaths: [SENTINEL_FILE] }, timeoutMs: 60_000,
    })).json()
    check(typeof reAuth?.grantId === 'string', 're-authorize issues a fresh grant')

    const reExec = await httpJson(`${ready2}/api/execute`, {
      method: 'POST', token: token2, body: { workUnitId }, timeoutMs: 300_000,
    })
    const reExecBody = await reExec.json()
    check(reExec.status === 200, 're-authorized execution completes', `status=${reExec.status}`)

    // The phase-1 file stays dirty on purpose: pre-existing dirty files are
    // never counted as NEW execution evidence. Success here comes from the
    // authoritative test pass, not from re-claiming the old dirty file.
    const reEvidence = reExecBody?.workUnit?.evidence ?? []
    check(
      reEvidence.some((e) => e.kind === 'test' && e.summary.includes('tests passed')),
      're-execution test evidence passed without claiming pre-existing dirty files',
    )
    check(
      reEvidence.some((e) => e.kind === 'repository' && e.summary.includes('Changes produced by this execution: 0')),
      'repository evidence does not count pre-existing dirty files as new execution',
    )

    await new Promise((r) => { backend2.kill('SIGTERM'); backend2.once('exit', r) })
  } finally {
    for (const child of children) {
      if (child.exitCode === null && !child.killed) {
        child.kill('SIGTERM')
      }
    }
    await new Promise((r) => setTimeout(r, 1500))
    // Bounded residual sweep: only processes whose command line references this
    // ephemeral scratch path (backend children, harness sessions, mock server).
    let scratchRefs = []
    try {
      scratchRefs = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-Command',
          `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${scratch}*' } | Select-Object -ExpandProperty ProcessId`],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim().split(/\r?\n/).filter(Boolean)
    } catch {
      scratchRefs = []
    }
    for (const pid of scratchRefs) {
      try { execFileSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' }) } catch { /* already gone */ }
    }
    if (failures === 0) {
      rmSync(scratch, { recursive: true, force: true })
    } else {
      console.log(`scratch kept for diagnosis: ${scratch}`)
    }
  }

  console.log(`SCRATCH MUTATION RESULT: ${failures === 0 ? 'PASS' : 'FAIL'}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(`SCRATCH MUTATION RESULT: FAIL — ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
