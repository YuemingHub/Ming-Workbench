import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const READY_PREFIX = 'MING_WORKBENCH_READY '

/**
 * Resolve the Workbench backend entry script. The script itself is plain
 * JavaScript; only its imports need the compiled `.tmp` output.
 */
export function resolveBackendScript(workbenchRoot) {
  return resolve(workbenchRoot, 'scripts', 'start-local-web.mjs')
}

/**
 * Parse the machine-readable backend handshake line emitted by
 * scripts/start-local-web.mjs. Returns the loopback URL or undefined.
 */
export function parseBackendReadyLine(line) {
  if (!line.startsWith(READY_PREFIX)) return undefined
  const url = line.slice(READY_PREFIX.length).trim()
  return /^http:\/\/127\.0\.0\.1:\d+$/.test(url) ? url : undefined
}

function runTreeKill(pid) {
  return new Promise((resolvePromise) => {
    // On Windows, taskkill with /T kills the whole child process tree, which
    // includes any in-flight Harness/ACP node children of the backend.
    const args =
      process.platform === 'win32'
        ? ['/pid', String(pid), '/T', '/F']
        : ['-TERM', '-p', String(pid)]
    const command = process.platform === 'win32' ? 'taskkill' : 'kill'
    const child = spawn(command, args, { stdio: 'ignore', windowsHide: true })
    child.once('error', () => resolvePromise())
    child.once('exit', () => resolvePromise())
    child.once('close', () => resolvePromise())
  })
}

/**
 * Terminate a process and its descendants. First attempts a graceful signal,
 * then falls back to a forced tree kill. Used so the desktop shell never leaves
 * a Workbench backend or a Harness ACP child running after the window closes.
 */
export async function killProcessTree(pid, { graceMs = 1200 } = {}) {
  if (!pid) return
  try {
    process.kill(pid, 'SIGTERM')
  } catch {
    // Process already gone.
  }

  await new Promise((resolvePromise) => setTimeout(resolvePromise, graceMs))

  if (process.platform === 'win32') {
    await runTreeKill(pid)
    return
  }

  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    // Process already gone.
  }
  try {
    process.kill(-pid, 'SIGKILL')
  } catch {
    // No process group or already gone.
  }
}

export function spawnBackend({
  nodeBin,
  script,
  projectRoot,
  workbenchRoot,
  harnessCheckout,
  extraArgs = [],
  extraEnv,
}) {
  if (!existsSync(script)) {
    throw new Error(
      `Workbench backend script is missing at ${script}. Run \`npm run build:test\` first.`,
    )
  }
  if (!existsSync(projectRoot)) {
    throw new Error(`Selected project directory does not exist: ${projectRoot}`)
  }

  const args = [
    script,
    '--project',
    projectRoot,
    '--workbench-root',
    workbenchRoot,
    ...(harnessCheckout ? ['--harness-checkout', harnessCheckout] : []),
    ...extraArgs,
  ]

  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  if (extraEnv) {
    Object.assign(env, extraEnv)
  }

  const child = spawn(nodeBin, args, {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  let settled = false
  let stdoutBuffer = ''
  let stderrTail = ''

  const readyPromise = new Promise((resolvePromise, rejectPromise) => {
    const fail = (message) => {
      if (settled) return
      settled = true
      rejectPromise(new Error(message))
    }

    child.stdout.on('data', (chunk) => {
      stdoutBuffer += chunk.toString()
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) {
        const url = parseBackendReadyLine(line)
        if (url) {
          if (settled) return
          settled = true
          resolvePromise(url)
        }
      }
    })
    child.stdout.pipe(process.stdout)

    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderrTail = (stderrTail + text).slice(-4000)
    })
    child.stderr.pipe(process.stderr)

    child.once('error', (error) => {
      fail(`Workbench backend failed to start: ${error.message}`)
    })

    child.once('exit', (code) => {
      const detail = stderrTail.trim() ? `\n${stderrTail.trim()}` : ''
      fail(
        `Workbench backend exited before becoming ready (exit ${code ?? 'unknown'}).${detail}`,
      )
    })
  })

  const handle = {
    pid: child.pid,
    ready: readyPromise,
    async kill() {
      await killProcessTree(child.pid)
    },
  }
  return handle
}
