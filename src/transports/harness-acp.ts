import { execFileSync, spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
  assertWorkbenchExecutionBinding,
  renderHarnessGrantMessage,
  type ProviderExecutionGrant,
  type WorkbenchExecutionBinding,
} from '../execution/provider-grant.js'
import type { WorkUnit } from '../core/model.js'

export interface HarnessAcpRunOptions {
  grant: ProviderExecutionGrant
  /** Optional Workbench-owned correlation; supply both binding and Work Unit or neither. */
  binding?: WorkbenchExecutionBinding
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
  /**
   * Execution-isolation context: when the Harness operates inside a disposable
   * worktree of a real authorized repository, `cwd` is the worktree (not the
   * real repo). The workspace assertion then validates worktree ownership +
   * the granted base ref instead of the real repo's working ref.
   */
  isolation?: {
    realRepository: string
    baseRef: string
  }
}

export interface HarnessAcpReadOnlyIntakeOptions {
  prompt: string
  /** Absolute project directory that Intake may inspect read-only. */
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

export type HarnessPermissionMode = 'read-only' | 'workspace-write'
export type WorkbenchAcpConfig = 'workbench.cordis.yml' | 'intake.cordis.yml'

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
  // When the Workbench backend sidecar runs as `electron.exe` with
  // ELECTRON_RUN_AS_NODE, the ACP child runner must inherit the same mode so
  // `process.execPath` behaves as Node instead of opening a GUI. This is only
  // present when the desktop shell explicitly set it; it never weakens what the
  // Harness child is allowed to run.
  'ELECTRON_RUN_AS_NODE',
  // Provider infrastructure credentials only. Task-specific credentials
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

export function resolveHarnessTsxCli(harnessCheckout: string): string {
  return join(resolve(harnessCheckout), 'node_modules', 'tsx', 'dist', 'cli.mjs')
}

export function assertHarnessAcpAdmission(
  options: Pick<HarnessAcpRunOptions, 'grant' | 'binding' | 'workUnit'>,
): void {
  assertHarnessExecutionGrant(options.grant)

  const hasBinding = options.binding !== undefined
  const hasWorkUnit = options.workUnit !== undefined
  if (hasBinding !== hasWorkUnit) {
    throw new Error(
      'Workbench execution correlation requires both binding and Work Unit, or neither.',
    )
  }
  if (options.binding && options.workUnit) {
    assertWorkbenchExecutionBinding(options.grant, options.binding, options.workUnit)
  }
}

export function assertGrantWorkspace(
  grant: ProviderExecutionGrant,
  cwd: string,
  isolation?: { realRepository: string; baseRef: string },
): void {
  const workspace = resolve(cwd)
  // Establish that this is a real git worktree before any provider process starts.
  git(workspace, ['rev-parse', '--is-inside-work-tree'])

  if (grant.authorization.mutation_boundary !== 'write-authorized') return

  const target = grant.authorization.write_target
  if (target === null) {
    throw new Error('write-authorized grant has no exact write target')
  }

  // The grant's repository identity is either a GitHub slug (CI worktrees) or
  // the exact local project path the human authorized (desktop local projects).
  // Accept both; reject everything else.
  let remote = ''
  try {
    remote = git(workspace, ['remote', 'get-url', 'origin'])
  } catch {
    // A local-path grant is still valid for a repository without an origin.
  }
  const repository = normalizeGitHubRepository(remote)
  const matchesSlug =
    repository !== undefined
    && repository.toLowerCase() === target.repository.toLowerCase()
  // Execution isolation: `cwd` is a disposable worktree, not the real repo, so
  // the real-repo path is the authority for the grant workspace match.
  const realRepo = isolation?.realRepository
  const matchesPath = realRepo
    ? sameResolvedPath(target.repository, realRepo)
    : sameResolvedPath(target.repository, workspace)
  if (!matchesSlug && !matchesPath) {
    throw new Error(
      `Grant repository ${target.repository} does not match workspace origin ${(repository ?? remote) || '<none>'}.`,
    )
  }

  // The working ref may be a branch name or (detached HEAD) a commit SHA.
  const currentBranch = git(workspace, ['branch', '--show-current'])
  const currentHead = git(workspace, ['rev-parse', 'HEAD'])
  const isolationBase = isolation?.baseRef
  const matchesWorkingRef =
    target.working_ref === currentBranch
    || target.working_ref === currentHead
    // A disposable isolation worktree is detached at the granted base ref; the
    // real repo's branch/working ref is out of reach there by design.
    || (isolationBase !== undefined && currentHead === isolationBase)
  if (!matchesWorkingRef) {
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

function sameResolvedPath(left: string, right: string): boolean {
  const a = resolve(left)
  const b = resolve(right)
  return process.platform === 'win32'
    ? a.toLowerCase() === b.toLowerCase()
    : a === b
}

export function buildHarnessChildEnvForPermission(
  source: NodeJS.ProcessEnv,
  options: Pick<
    HarnessAcpReadOnlyIntakeOptions,
    'harnessCheckout' | 'workbenchRoot' | 'provider' | 'model' | 'sessionRoot'
  >,
  permissionMode: HarnessPermissionMode,
  configName: WorkbenchAcpConfig,
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
  env.DSH_PERMISSION_MODE = permissionMode
  env.MING_WORKBENCH_ACP_CONFIG = configName
  return env
}

export function buildHarnessChildEnv(
  source: NodeJS.ProcessEnv,
  options: Pick<
    HarnessAcpRunOptions,
    'harnessCheckout' | 'workbenchRoot' | 'provider' | 'model' | 'sessionRoot'
  >,
  grant: ProviderExecutionGrant,
): NodeJS.ProcessEnv {
  return buildHarnessChildEnvForPermission(
    source,
    options,
    grant.authorization.mutation_boundary === 'read-only'
      ? 'read-only'
      : 'workspace-write',
    'workbench.cordis.yml',
  )
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

interface HarnessAcpPromptOptions {
  prompt: string
  cwd: string
  harnessCheckout: string
  workbenchRoot: string
  env: NodeJS.ProcessEnv
  shutdownGraceMs?: number
  label: string
}

async function runHarnessAcpPrompt(
  options: HarnessAcpPromptOptions,
): Promise<HarnessAcpRunResult> {
  const workbenchRoot = resolve(options.workbenchRoot)
  const harnessCheckout = resolve(options.harnessCheckout)
  const workspace = resolve(options.cwd)
  const launcher = join(workbenchRoot, 'harness', 'acp', 'launcher.mjs')
  const tsxCli = resolveHarnessTsxCli(harnessCheckout)
  const harnessTsconfig = join(harnessCheckout, 'tsconfig.json')

  if (!existsSync(launcher)) {
    throw new Error(`Workbench ACP launcher is missing at ${launcher}.`)
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
      // ACP gets exclusive stdout. Diagnostics may pass through stderr.
      stdio: ['pipe', 'pipe', 'pipe'],
      env: options.env,
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
      // Standing permission is fixed before process launch. Any same-turn request
      // to widen it is rejected; a fresh AAOP authorization decision is required.
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
      throw new Error(`${options.label} returned no session id`)
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
    throw new Error(`${options.label} ended before a complete prompt result was received`)
  }

  return {
    sessionId,
    stopReason: promptResult.stopReason,
    assistantText: chunks.join(''),
  }
}

/**
 * Run one already-authorized AAOP Provider Execution Grant through a fresh
 * DeepSeek Harness ACP session. This function does not decide Route,
 * authorization, Task Pod membership, or final acceptance.
 */
export async function runHarnessAcpGrant(
  options: HarnessAcpRunOptions,
): Promise<HarnessAcpRunResult> {
  assertHarnessAcpAdmission(options)
  assertReviewedHarnessCheckout(options.harnessCheckout)
  assertGrantWorkspace(options.grant, options.cwd, options.isolation)

  return runHarnessAcpPrompt({
    prompt: renderHarnessGrantMessage(options.grant),
    cwd: options.cwd,
    harnessCheckout: options.harnessCheckout,
    workbenchRoot: options.workbenchRoot,
    env: buildHarnessChildEnv(process.env, options, options.grant),
    shutdownGraceMs: options.shutdownGraceMs,
    label: 'Harness ACP execution',
  })
}

/**
 * Run ordinary-language Developer Intake through the same reviewed Harness ACP
 * transport but a dedicated Workbench-owned hard-read-only profile. No Provider
 * Execution Grant exists yet, so the session cannot widen authority or mutate.
 */
export async function runHarnessAcpReadOnlyIntake(
  options: HarnessAcpReadOnlyIntakeOptions,
): Promise<HarnessAcpRunResult> {
  if (!options.prompt.trim()) {
    throw new Error('AAOP Developer Intake prompt is required')
  }
  assertReviewedHarnessCheckout(options.harnessCheckout)

  return runHarnessAcpPrompt({
    prompt: options.prompt,
    cwd: options.cwd,
    harnessCheckout: options.harnessCheckout,
    workbenchRoot: options.workbenchRoot,
    env: buildHarnessChildEnvForPermission(
      process.env,
      options,
      'read-only',
      'intake.cordis.yml',
    ),
    shutdownGraceMs: options.shutdownGraceMs,
    label: 'Harness ACP Intake',
  })
}

export interface HarnessProviderProbeOptions {
  /** Absolute reviewed DeepSeek Harness source checkout. */
  harnessCheckout: string
  /** Absolute Ming Workbench checkout containing harness/acp/launcher.mjs. */
  workbenchRoot: string
  provider?: string
  model?: string
  sessionRoot?: string
  shutdownGraceMs?: number
}

/**
 * Real provider round trip: runs one minimal read-only ACP session against
 * the configured provider/model so the product can honestly report "已连接"
 * or a human-readable failure. The probe never touches a project, never
 * calls tools, and runs in a disposable temp directory.
 */
export async function runHarnessProviderProbe(
  options: HarnessProviderProbeOptions,
): Promise<HarnessAcpRunResult> {
  assertReviewedHarnessCheckout(options.harnessCheckout)

  const probeDir = mkdtempSync(join(tmpdir(), 'mw-provider-probe-'))
  try {
    return await runHarnessAcpPrompt({
      prompt: '只回复「OK」。不要调用任何工具，不要读取或修改任何文件，不要做任何其他事情。',
      cwd: probeDir,
      harnessCheckout: options.harnessCheckout,
      workbenchRoot: options.workbenchRoot,
      env: buildHarnessChildEnvForPermission(
        process.env,
        options,
        'read-only',
        'workbench.cordis.yml',
      ),
      shutdownGraceMs: options.shutdownGraceMs,
      label: 'Harness Provider Probe',
    })
  } finally {
    rmSync(probeDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}
