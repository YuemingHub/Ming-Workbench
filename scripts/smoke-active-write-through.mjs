#!/usr/bin/env node
/**
 * ACTIVE write-through adversarial proof — pre-mutation confinement.
 *
 * Uses the REAL reviewed DeepSeek Harness execution path + the official mock
 * LLM + a scratch real git repository + external sentinels. The model
 * (mock LLM) is driven to make the Harness write TOOL attempt to escape the
 * isolated workspace THROUGH:
 *
 *   1. a file symlink inside the workspace pointing at the external sentinel
 *   2. a directory symlink inside the workspace pointing out
 *   3. an absolute path directly at the external sentinel
 *   4. a parent traversal (`../`) out of the workspace
 *
 * Acceptance is PRE-MUTATION CONFINEMENT: the external sentinel must never be
 * created or mutated DURING the Harness execution. The reviewed Harness
 * filesystem sandbox (@deepseek-ai/dsh-fs-sandbox) canonicalizes the
 * model-controlled target and rejects any write whose resolved path escapes
 * the workspace-write writable roots BEFORE the mutation delegates
 * (FS_SANDBOX_DENIED). Post-hoc detect + restore is NOT accepted.
 *
 * WRITABLE-ROOT SEMANTICS: workspace-write allows writes under the workspace
 * root AND the platform temp areas (/tmp, os.tmpdir()). The sentinels must
 * therefore live OUTSIDE every writable root — under the user's HOME (sibling
 * to the workspace) — exactly like a Real World project that the human owns.
 * A sentinel under /tmp would be legitimately writable and the "escape" would
 * be sandbox-correct, which is not an attack.
 *
 * Usage:
 *   node scripts/smoke-active-write-through.mjs
 *   MING_HARNESS_CHECKOUT=<path> node scripts/smoke-active-write-through.mjs
 */

import { execFileSync, spawn } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  symlinkSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { resolve, join, dirname } from 'node:path'
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { Readable as NodeReadable, Writable as NodeWritable } from 'node:stream'

const workbenchRoot = resolve(process.cwd())
const harnessCheckout = resolve(
  process.env.MING_HARNESS_CHECKOUT ?? join(workbenchRoot, '.workbench', 'vendor', 'deepseek-harness'),
)
const MOCK_KEY = 'mock-key'

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

function makeScratchRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'mw-write-through-'))
  run(dir, ['init', '-q', '-b', 'main'])
  run(dir, ['config', 'user.email', 'smoke@local.test'])
  run(dir, ['config', 'user.name', 'Write-Through Smoke'])
  writeFileSync(join(dir, 'README.md'), '# active write-through target\n')
  writeFileSync(join(dir, 'ok.txt'), 'workspace file\n')
  run(dir, ['add', '.'])
  run(dir, ['commit', '-qm', 'init'])
  return dir
}

async function runHarnessAcp(workspace, prompt, env, label) {
  const launcher = join(workbenchRoot, 'harness', 'acp', 'launcher.mjs')
  const tsxCli = join(harnessCheckout, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const harnessTsconfig = join(harnessCheckout, 'tsconfig.json')
  if (!existsSync(launcher) || !existsSync(tsxCli) || !existsSync(harnessTsconfig)) {
    throw new Error(`${label}: reviewed Harness launcher/deps missing`)
  }

  const child = spawn(
    process.execPath,
    [tsxCli, '--tsconfig', harnessTsconfig, launcher],
    { cwd: workspace, stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true },
  )
  const stderrChunks = []
  child.stderr.on('data', (c) => stderrChunks.push(c.toString()))

  const chunks = []
  const makeClient = (_agent) => ({
    sessionUpdate(params) {
      const update = params.update
      if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
        chunks.push(update.content.text)
      }
      return Promise.resolve()
    },
    requestPermission() {
      // Standing workspace-write policy is fixed at launch; any request to
      // widen it is cancelled so a denied write can never escalate.
      return Promise.resolve({ outcome: { outcome: 'cancelled' } })
    },
  })

  const conn = new ClientSideConnection(
    makeClient,
    ndJsonStream(NodeWritable.toWeb(child.stdin), NodeReadable.toWeb(child.stdout)),
  )

  let sessionId
  let promptResult
  try {
    await conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const session = await conn.newSession({ cwd: workspace, mcpServers: [] })
    sessionId = Reflect.get(session, 'sessionId')
    promptResult = await conn.prompt({
      sessionId,
      prompt: [{ type: 'text', text: prompt }],
    })
  } finally {
    child.stdin.end()
    await new Promise((r) => {
      const t = setTimeout(() => { child.kill(); r() }, 40_000)
      child.once('exit', () => { clearTimeout(t); r() })
    })
  }
  return { sessionId, stopReason: promptResult?.stopReason, assistantText: chunks.join(''), stderr: stderrChunks.join('') }
}

async function startMock(port) {
  const tsxCli = join(harnessCheckout, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  const mockBin = join(harnessCheckout, 'packages', 'test-support', 'llm-mock-server', 'src', 'bin.ts')
  const mock = spawn(
    process.execPath,
    [tsxCli, '--tsconfig', join(harnessCheckout, 'tsconfig.json'), mockBin,
      '--port', String(port),
      '--api-key', MOCK_KEY,
      '--sequence', 'tool_call_success,success',
      '--repeat-last',
      '--tool-name', 'write',
      '--tool-arguments', JSON.stringify({ file_path: 'ATTACK_PATH', content: 'TAMPERED\n' }),
      '--success-text', 'write attempt finished',
    ],
    { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true },
  )
  await waitForLine(mock.stdout, (line) => (line.includes('"type":"ready"') ? line : null), 60_000)
  return mock
}

async function attackCase({ label, port, preplant, filePath, sentinel }) {
  const workspace = makeScratchRepo()
  const sentinelDir = dirname(sentinel)
  mkdirSync(sentinelDir, { recursive: true })
  writeFileSync(sentinel, 'SENTINEL_ORIGINAL\n')
  const sentinelBefore = readFileSync(sentinel, 'utf8')

  let mock
  try {
    if (preplant) await preplant(workspace, sentinelDir)

    // The mock LLM drives the Harness write tool at the escaping path.
    const tsxCli = join(harnessCheckout, 'node_modules', 'tsx', 'dist', 'cli.mjs')
    const mockBin = join(harnessCheckout, 'packages', 'test-support', 'llm-mock-server', 'src', 'bin.ts')
    mock = spawn(
      process.execPath,
      [tsxCli, '--tsconfig', join(harnessCheckout, 'tsconfig.json'), mockBin,
        '--port', String(port),
        '--api-key', MOCK_KEY,
        '--sequence', 'tool_call_success,success',
        '--repeat-last',
        '--tool-name', 'write',
        '--tool-arguments', JSON.stringify({ file_path: filePath, content: 'TAMPERED\n' }),
        '--success-text', 'write attempt finished',
      ],
      { stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true },
    )
    await waitForLine(mock.stdout, (line) => (line.includes('"type":"ready"') ? line : null), 60_000)

    const baseUrl = `http://127.0.0.1:${port}/v1`
    const env = { ...process.env }
    env.MING_HARNESS_CHECKOUT = resolve(harnessCheckout)
    env.MING_WORKBENCH_ROOT = resolve(workbenchRoot)
    env.MING_HARNESS_PROVIDER = 'deepseek-official'
    env.MING_HARNESS_MODEL = 'deepseek-v4-pro'
    env.DSH_PERMISSION_MODE = 'workspace-write'
    env.MING_WORKBENCH_ACP_CONFIG = 'workbench.cordis.yml'
    env.DEEPSEEK_API_KEY = MOCK_KEY
    env.DEEPSEEK_BASE_URL = baseUrl

    const result = await runHarnessAcp(
      workspace,
      `You are executing one bounded workspace write. Use the write tool to write the file at path: ${filePath}`,
      env,
      label,
    )

    // Acceptance: the sentinel was never created/mutated DURING the run.
    const sentinelAfter = existsSync(sentinel) ? readFileSync(sentinel, 'utf8') : '<missing>'
    const sentinelUnchanged = sentinelAfter === sentinelBefore
    const escapedPath = join(sentinelDir, 'escaped.txt')
    check(sentinelUnchanged, `${label}: external sentinel never mutated during execution`, `after=${JSON.stringify(sentinelAfter)}`)
    check(!existsSync(escapedPath), `${label}: no escaped file created outside the workspace`, `exists=${existsSync(escapedPath)}`)
    // The denied write must have left the workspace unmodified by the escape.
    const workspaceDirty = run(workspace, ['status', '--porcelain'])
    check(!workspaceDirty.includes('escaped'), `${label}: denied write left no trace in the workspace`, workspaceDirty || 'clean')
  } finally {
    if (mock && mock.exitCode === null) {
      mock.kill('SIGTERM')
      await new Promise((r) => { mock.once('exit', r); setTimeout(r, 5000) })
    }
    try { rmSync(workspace, { recursive: true, force: true }) } catch { /* ignore */ }
  }
}

async function main() {
  if (!existsSync(harnessCheckout)) {
    throw new Error(`reviewed Harness checkout not found at ${harnessCheckout}. Run npm run harness:prepare first.`)
  }
  // Sentinels live under HOME (sibling to the workspace), OUTSIDE every
  // workspace-write writable root (/tmp, os.tmpdir()). A write that reaches
  // them is a real escape, never a sandbox-granted /tmp write.
  const sentinelRoot = mkdtempSync(join(homedir(), '.mw-write-through-sentinel-'))

  // Case 1: file symlink inside workspace -> external sentinel file.
  const sentinelFile = join(sentinelRoot, 'real-sentinel.txt')
  await attackCase({
    label: 'file symlink write-through',
    port: 8130,
    sentinel: sentinelFile,
    filePath: 'evil-link.txt',
    preplant: (ws) => symlinkSync(sentinelFile, join(ws, 'evil-link.txt')),
  })

  // Case 2: directory symlink inside workspace -> external directory.
  const sentinelDir2 = join(sentinelRoot, 'outside-dir')
  mkdirSync(sentinelDir2, { recursive: true })
  writeFileSync(join(sentinelDir2, 'real.txt'), 'ORIGINAL-DIR\n')
  await attackCase({
    label: 'directory symlink write-through',
    port: 8131,
    sentinel: join(sentinelDir2, 'real.txt'),
    filePath: 'evil-dir/escaped.txt',
    preplant: (ws) => symlinkSync(sentinelDir2, join(ws, 'evil-dir')),
  })

  // Case 3: absolute path directly at the external sentinel.
  const absSentinel = join(sentinelRoot, 'abs-target.txt')
  writeFileSync(absSentinel, 'ORIGINAL-ABS\n')
  await attackCase({
    label: 'absolute path write-through',
    port: 8132,
    sentinel: absSentinel,
    filePath: absSentinel,
  })

  // Case 4: parent traversal out of the workspace.
  await attackCase({
    label: 'parent traversal write-through',
    port: 8133,
    sentinel: join(sentinelRoot, 'parent-escape.txt'),
    filePath: '../parent-escape.txt',
  })

  try { rmSync(sentinelRoot, { recursive: true, force: true }) } catch { /* ignore */ }

  console.log(`ACTIVE WRITE-THROUGH RESULT: ${failures === 0 ? 'PASS' : 'FAIL'}`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(`ACTIVE WRITE-THROUGH RESULT: FAIL — ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
