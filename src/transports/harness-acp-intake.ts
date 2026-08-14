import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Readable as NodeReadable, Writable as NodeWritable } from 'node:stream'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent as AcpAgent,
  type Client,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type StopReason,
} from '@agentclientprotocol/sdk'
import {
  assertReviewedHarnessCheckout,
  resolveHarnessTsxCli,
  type HarnessAcpRunResult,
} from './harness-acp.js'

export interface HarnessAcpReadOnlyIntakeOptions {
  prompt: string
  /** Absolute local project directory that Intake may inspect read-only. */
  cwd: string
  /** Absolute reviewed DeepSeek Harness source checkout. */
  harnessCheckout: string
  /** Absolute Ming Workbench checkout containing the dedicated Intake launcher. */
  workbenchRoot: string
  provider?: string
  model?: string
  sessionRoot?: string
  shutdownGraceMs?: number
}

const SAFE_INHERITED_ENV = [
  'PATH',
  'Path',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'TMP',
  'TEMP',
  'SystemRoot',
  'ComSpec',
  'PATHEXT',
  'PNPM_HOME',
  'XDG_CONFIG_HOME',
  'XDG_CACHE_HOME',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  // Provider infrastructure credentials only. Developer Intake must not inherit
  // repository, deploy, database, or other task-specific credentials.
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_BASE_URL',
] as const

function buildReadOnlyIntakeEnv(
  source: NodeJS.ProcessEnv,
  options: HarnessAcpReadOnlyIntakeOptions,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const name of SAFE_INHERITED_ENV) {
    const value = source[name]
    if (value !== undefined) env[name] = value
  }

  env.MING_HARNESS_CHECKOUT = resolve(options.harnessCheckout)
  env.MING_WORKBENCH_ROOT = resolve(options.workbenchRoot)
  env.MING_HARNESS_PROVIDER = options.provider ?? 'deepseek-official'
  env.MING_HARNESS_MODEL = options.model ?? 'deepseek-v4-pro'
  if (options.sessionRoot) env.MING_WORKBENCH_SESSION_ROOT = resolve(options.sessionRoot)
  env.DSH_PERMISSION_MODE = 'read-only'
  return env
}

function waitForExit(child: ChildProcessWithoutNullStreams, graceMs: number): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      child.kill()
    }, graceMs)

    child.once('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise()
    })
  })
}

/**
 * Run one ordinary-language AAOP Developer Intake prompt through a dedicated
 * hard-read-only Harness ACP profile. This phase exists before a Provider
 * Execution Grant and therefore cannot widen authority or approve tool writes.
 */
export async function runHarnessAcpReadOnlyIntake(
  options: HarnessAcpReadOnlyIntakeOptions,
): Promise<HarnessAcpRunResult> {
  if (!options.prompt.trim()) {
    throw new Error('AAOP Developer Intake prompt is required')
  }

  assertReviewedHarnessCheckout(options.harnessCheckout)

  const workbenchRoot = resolve(options.workbenchRoot)
  const harnessCheckout = resolve(options.harnessCheckout)
  const workspace = resolve(options.cwd)
  const launcher = join(workbenchRoot, 'harness', 'acp', 'intake-launcher.mjs')
  const tsxCli = resolveHarnessTsxCli(harnessCheckout)
  const harnessTsconfig = join(harnessCheckout, 'tsconfig.json')

  if (!existsSync(launcher)) {
    throw new Error(`Workbench read-only Intake launcher is missing at ${launcher}.`)
  }
  if (!existsSync(tsxCli)) {
    throw new Error(
      `Harness tsx runner is missing at ${tsxCli}. Run \`npm run harness:prepare\` or reinstall the reviewed Harness checkout.`,
    )
  }
  if (!existsSync(harnessTsconfig)) {
    throw new Error(`Harness root tsconfig is missing at ${harnessTsconfig}.`)
  }

  const child = spawn(
    process.execPath,
    [tsxCli, '--tsconfig', harnessTsconfig, launcher],
    {
      cwd: workspace,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildReadOnlyIntakeEnv(process.env, options),
      windowsHide: true,
    },
  )
  child.stderr.pipe(process.stderr)

  const chunks: string[] = []
  const makeClient = (_agent: AcpAgent): Client => ({
    sessionUpdate(params: SessionNotification): Promise<void> {
      const update = params.update
      if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
        chunks.push(update.content.text)
      }
      return Promise.resolve()
    },
    requestPermission(_params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
      // Intake is hard read-only. Any runtime request for additional permission
      // is rejected rather than converted into a new authorization decision.
      return Promise.resolve({ outcome: { outcome: 'cancelled' } })
    },
  })

  const conn = new ClientSideConnection(
    makeClient,
    ndJsonStream(
      NodeWritable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      NodeReadable.toWeb(child.stdout) as ReadableStream<Uint8Array>,
    ),
  )

  let sessionId: string | undefined
  let promptResult: { stopReason: StopReason } | undefined
  try {
    await conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    })
    const session = await conn.newSession({ cwd: workspace, mcpServers: [] })
    const returnedSessionId: unknown = Reflect.get(session, 'sessionId')
    if (typeof returnedSessionId !== 'string' || returnedSessionId.length === 0) {
      throw new Error('Harness ACP Intake server returned no session id')
    }
    sessionId = returnedSessionId

    promptResult = await conn.prompt({
      sessionId,
      prompt: [{ type: 'text', text: options.prompt }],
    })
  } finally {
    child.stdin.end()
    await waitForExit(child, options.shutdownGraceMs ?? 10_000)
  }

  if (!sessionId || !promptResult) {
    throw new Error('Harness ACP Intake ended before a complete prompt result was received')
  }

  return {
    sessionId,
    stopReason: promptResult.stopReason,
    assistantText: chunks.join(''),
  }
}
