import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
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
  HARNESS_REVIEWED_COMMIT,
  HARNESS_REVIEWED_VERSION,
} from '../hosts/harness.js'
import {
  assertHarnessExecutionGrant,
  renderHarnessGrantMessage,
  type ProviderExecutionGrant,
} from '../execution/provider-grant.js'
import type { WorkUnit } from '../core/model.js'

export interface HarnessAcpRunOptions {
  grant: ProviderExecutionGrant
  workUnit?: WorkUnit
  /** Absolute local checkout that the Harness agent will operate on. */
  cwd: string
  /** Absolute reviewed DeepSeek Harness source checkout. */
  harnessCheckout: string
  /** Absolute Ming Workbench checkout containing harness/acp/launcher.mjs. */
  workbenchRoot: string
  provider?: string
  model?: string
  sessionRoot?: string
  shutdownGraceMs?: number
}

export interface HarnessAcpRunResult {
  sessionId: string
  stopReason: StopReason
  assistantText: string
}

export interface HarnessCheckoutIdentity {
  commit: string
  sourceVersion: string
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
  // P0 provider infrastructure credentials only. Task-specific credentials
  // (GitHub, cloud deploy keys, databases, etc.) are deliberately not inherited.
  'DEEPSEEK_API_KEY',
  'DEEPSEEK_BASE_URL',
] as const

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function normalizeGitHubRepository(remote: string): string | undefined {
  const trimmed = remote.trim().replace(/\.git$/i, '')
  const ssh = /^git@github\.com:([^/]+\/[^/]+)$/i.exec(trimmed)
  if (ssh) return ssh[1]
  const sshUrl = /^ssh:\/\/git@github\.com\/([^/]+\/[^/]+)$/i.exec(trimmed)
  if (sshUrl) return sshUrl[1]
  const https = /^https?:\/\/github\.com\/([^/]+\/[^/]+)$/i.exec(trimmed)
  if (https) return https[1]
  return undefined
}

export function inspectHarnessCheckout(harnessCheckout: string): HarnessCheckoutIdentity {
  const checkout = resolve(harnessCheckout)
  const pkg = JSON.parse(
    readFileSync(join(checkout, 'apps', 'cli', 'package.json'), 'utf8'),
  ) as { version?: unknown }

  return {
    commit: git(checkout, ['rev-parse', 'HEAD']),
    sourceVersion: typeof pkg.version === 'string' ? pkg.version : '',
  }
}

export function assertReviewedHarnessCheckout(harnessCheckout: string): void {
  const identity = inspectHarnessCheckout(harnessCheckout)
  if (
    identity.commit !== HARNESS_REVIEWED_COMMIT
    || identity.sourceVersion !== HARNESS_REVIEWED_VERSION
  ) {
    throw new Error(
      `Unreviewed DeepSeek Harness checkout: expected ${HARNESS_REVIEWED_VERSION} @ ${HARNESS_REVIEWED_COMMIT}, detected ${identity.sourceVersion || '<unknown>'} @ ${identity.commit || '<unknown>'}.`,
    )
  }
}

export function assertGrantWorkspace(
  grant: ProviderExecutionGrant,
  cwd: string,
): void {
  const workspace = resolve(cwd)
  // Establish that this is a real git worktree before any provider process starts.
  git(workspace, ['rev-parse', '--is-inside-work-tree'])

  if (grant.authorization.mutation_boundary !== 'write-authorized') return

  const target = grant.authorization.write_target
  if (target === null) {
    throw new Error('write-authorized grant has no exact write target')
  }

  const remote = git(workspace, ['remote', 'get-url', 'origin'])
  const repository = normalizeGitHubRepository(remote)
  if (repository?.toLowerCase() !== target.repository.toLowerCase()) {
    throw new Error(
      `Grant repository ${target.repository} does not match workspace origin ${repository ?? remote}.`,
    )
  }

  const currentBranch = git(workspace, ['branch', '--show-current'])
  if (currentBranch !== target.working_ref) {
    throw new Error(
      `Grant working_ref ${target.working_ref} does not match current branch ${currentBranch || '<detached HEAD>'}.`,
    )
  }

  // The exact base must resolve locally or through origin. This is read-only and
  // prevents a misspelled/stale base ref from reaching the model as authority.
  try {
    git(workspace, ['rev-parse', '--verify', `${target.base_ref}^{commit}`])
  } catch {
    try {
      git(workspace, ['rev-parse', '--verify', `origin/${target.base_ref}^{commit}`])
    } catch {
      throw new Error(`Grant base_ref ${target.base_ref} does not resolve in the workspace.`)
    }
  }
}

export function buildHarnessChildEnv(
  source: NodeJS.ProcessEnv,
  options: Pick<
    HarnessAcpRunOptions,
    'harnessCheckout' | 'workbenchRoot' | 'provider' | 'model' | 'sessionRoot'
  >,
  grant: ProviderExecutionGrant,
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
  env.DSH_PERMISSION_MODE =
    grant.authorization.mutation_boundary === 'read-only'
      ? 'read-only'
      : 'workspace-write'

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
 * Run one already-authorized AAOP Provider Execution Grant through a fresh
 * DeepSeek Harness ACP session. This function does not decide Route,
 * authorization, Task Pod membership, or final acceptance.
 */
export async function runHarnessAcpGrant(
  options: HarnessAcpRunOptions,
): Promise<HarnessAcpRunResult> {
  assertHarnessExecutionGrant(options.grant, options.workUnit)
  assertReviewedHarnessCheckout(options.harnessCheckout)
  assertGrantWorkspace(options.grant, options.cwd)

  const workbenchRoot = resolve(options.workbenchRoot)
  const harnessCheckout = resolve(options.harnessCheckout)
  const workspace = resolve(options.cwd)
  const launcher = join(workbenchRoot, 'harness', 'acp', 'launcher.mjs')
  const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
  const child = spawn(
    pnpm,
    ['--dir', harnessCheckout, 'exec', 'tsx', launcher],
    {
      cwd: workspace,
      // Keep all streams piped so ACP gets exclusive stdout while diagnostics
      // can be forwarded verbatim from stderr without weakening the type/lifetime contract.
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildHarnessChildEnv(process.env, options, options.grant),
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
      // The process is already confined to the AAOP Grant's standing mode.
      // Any same-turn request to widen that mode is rejected; a fresh AAOP Grant
      // is required to change authority.
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
      throw new Error('Harness ACP server returned no session id')
    }
    sessionId = returnedSessionId

    promptResult = await conn.prompt({
      sessionId,
      prompt: [{ type: 'text', text: renderHarnessGrantMessage(options.grant) }],
    })
  } finally {
    child.stdin.end()
    await waitForExit(child, options.shutdownGraceMs ?? 10_000)
  }

  if (!sessionId || !promptResult) {
    throw new Error('Harness ACP execution ended before a complete prompt result was received')
  }

  return {
    sessionId,
    stopReason: promptResult.stopReason,
    assistantText: chunks.join(''),
  }
}
