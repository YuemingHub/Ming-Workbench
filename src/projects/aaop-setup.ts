import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  resolveProjectOnboarding,
  resolveProjectPythonCommand,
  type ProjectOnboardingResult,
} from './onboarding.js'

const AAOP_OWNER = 'YuemingHub'
const AAOP_REPO = 'Adaptive-Agent-Orchestration-Protocol'
const AAOP_API = `https://api.github.com/repos/${AAOP_OWNER}/${AAOP_REPO}`
const COMMIT_SHA = /^[0-9a-f]{40}$/
const GIT_BLOB_SHA = /^[0-9a-f]{40}$/

export interface AaopStableSource {
  revision: string
  version: string
  bootstrapBytes: Uint8Array
  bootstrapBlobSha: string
  versionBlobSha: string
}

export interface BootstrapRunInput {
  projectRoot: string
  pythonCommand: string
  source: AaopStableSource
}

export interface BootstrapRunResult {
  exitCode: number
  stdout: string
  stderr: string
}

export interface EnableProjectAaopOptions {
  projectRoot: string
  /** Must be true only after a human explicitly authorizes project setup. */
  authorized: boolean
  /** Packaged workbench root carrying a bundled Python runtime, if any. */
  workbenchRoot?: string
}

export type EnableProjectAaopResult =
  | {
      status: 'already-ready'
      onboarding: Extract<ProjectOnboardingResult, { status: 'ready' }>
    }
  | {
      status: 'installed'
      onboarding: Extract<ProjectOnboardingResult, { status: 'ready' }>
      sourceRevision: string
      aaopVersion: string
    }
  | {
      status: 'failed'
      reason: string
      sourceRevision?: string
      aaopVersion?: string
    }

interface FetchResponseLike {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

export type AaopSetupFetch = (
  url: string,
  init?: { headers?: Record<string, string> },
) => Promise<FetchResponseLike>

export interface AaopSetupDependencies {
  fetch?: AaopSetupFetch
  resolveStableSource?: () => Promise<AaopStableSource>
  resolveOnboarding?: (projectRoot: string) => ProjectOnboardingResult
  resolvePythonCommand?: () => string | undefined
  runBootstrap?: (input: BootstrapRunInput) => BootstrapRunResult
  targetIsDirectory?: (projectRoot: string) => boolean
}
interface GitHubRefResponse {
  object?: {
    sha?: unknown
  }
}

interface GitHubContentResponse {
  encoding?: unknown
  content?: unknown
  sha?: unknown
}

function defaultFetch(
  url: string,
  init?: { headers?: Record<string, string> },
): Promise<FetchResponseLike> {
  return fetch(url, init) as Promise<FetchResponseLike>
}

function isDirectory(projectRoot: string): boolean {
  try {
    return statSync(projectRoot).isDirectory()
  } catch {
    return false
  }
}

function safeBootstrapEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const names = [
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
    'HTTP_PROXY',
    'HTTPS_PROXY',
    'NO_PROXY',
    'http_proxy',
    'https_proxy',
    'no_proxy',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
  ] as const
  const env: NodeJS.ProcessEnv = {}
  for (const name of names) {
    const value = source[name]
    if (value !== undefined) env[name] = value
  }
  return env
}

export function computeGitBlobSha(bytes: Uint8Array): string {
  const header = Buffer.from(`blob ${bytes.byteLength}\0`, 'utf8')
  return createHash('sha1')
    .update(header)
    .update(bytes)
    .digest('hex')
}

async function fetchJson(
  fetcher: AaopSetupFetch,
  url: string,
): Promise<unknown> {
  const response = await fetcher(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Ming-Workbench-AAOP-Setup',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!response.ok) {
    throw new Error(`GitHub source request failed (${response.status}) for ${url}`)
  }
  return response.json()
}

function decodeExactContent(
  value: unknown,
  label: string,
): { bytes: Uint8Array; blobSha: string } {
  if (!value || typeof value !== 'object') {
    throw new Error(`${label} did not return a GitHub content object`)
  }
  const content = value as GitHubContentResponse
  if (content.encoding !== 'base64' || typeof content.content !== 'string') {
    throw new Error(`${label} did not return base64 file content`)
  }
  if (typeof content.sha !== 'string' || !GIT_BLOB_SHA.test(content.sha)) {
    throw new Error(`${label} did not return a valid Git blob identity`)
  }
  const bytes = Buffer.from(content.content.replace(/\s+/g, ''), 'base64')
  const computed = computeGitBlobSha(bytes)
  if (computed !== content.sha) {
    throw new Error(
      `${label} Git blob identity mismatch: expected ${content.sha}, computed ${computed}`,
    )
  }
  return { bytes, blobSha: content.sha }
}

/**
 * Resolve the currently promoted AAOP stable revision, then fetch bootstrap.py
 * and VERSION from that exact immutable revision. Each object is independently
 * checked against GitHub's Git blob identity before Workbench may execute it.
 */
export async function resolvePromotedAaopStableSource(
  fetcher: AaopSetupFetch = defaultFetch,
): Promise<AaopStableSource> {
  const refValue = await fetchJson(
    fetcher,
    `${AAOP_API}/git/ref/heads/stable`,
  ) as GitHubRefResponse
  const revision = refValue.object?.sha
  if (typeof revision !== 'string' || !COMMIT_SHA.test(revision)) {
    throw new Error('AAOP stable ref did not resolve to an exact commit SHA')
  }

  const [bootstrapValue, versionValue] = await Promise.all([
    fetchJson(
      fetcher,
      `${AAOP_API}/contents/scripts/bootstrap.py?ref=${revision}`,
    ),
    fetchJson(
      fetcher,
      `${AAOP_API}/contents/.aaop/VERSION?ref=${revision}`,
    ),
  ])
  const bootstrap = decodeExactContent(bootstrapValue, 'AAOP bootstrap.py')
  const versionObject = decodeExactContent(versionValue, 'AAOP VERSION')
  const version = Buffer.from(versionObject.bytes).toString('utf8').trim()
  if (!version) {
    throw new Error('AAOP stable VERSION is empty')
  }

  return {
    revision,
    version,
    bootstrapBytes: bootstrap.bytes,
    bootstrapBlobSha: bootstrap.blobSha,
    versionBlobSha: versionObject.blobSha,
  }
}

export function runCanonicalAaopBootstrap(
  input: BootstrapRunInput,
): BootstrapRunResult {
  const root = resolve(input.projectRoot)
  const temporary = mkdtempSync(join(tmpdir(), 'ming-workbench-aaop-setup-'))
  const bootstrapPath = join(temporary, 'bootstrap.py')
  try {
    writeFileSync(bootstrapPath, input.source.bootstrapBytes)
    const completed = spawnSync(
      input.pythonCommand,
      [
        bootstrapPath,
        '--target',
        root,
        '--ref',
        input.source.revision,
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: safeBootstrapEnv(process.env),
        windowsHide: true,
        timeout: 180_000,
      },
    )
    if (completed.error) {
      return {
        exitCode: -1,
        stdout: completed.stdout ?? '',
        stderr: completed.error.message,
      }
    }
    return {
      exitCode: completed.status ?? -1,
      stdout: completed.stdout ?? '',
      stderr: completed.stderr ?? '',
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

/**
 * Explicitly enable AAOP for one existing local project by delegating all
 * package lifecycle semantics to AAOP's canonical exact-revision bootstrap.
 *
 * Workbench does not auto-upgrade a project that is already onboarding-ready,
 * and it refuses ambiguous `.aaop` state instead of trying to claim it.
 */
export async function enableProjectAaop(
  options: EnableProjectAaopOptions,
  dependencies: AaopSetupDependencies = {},
): Promise<EnableProjectAaopResult> {
  if (!options.authorized) {
    return {
      status: 'failed',
      reason: 'AAOP project setup requires explicit human authorization.',
    }
  }

  const projectRoot = resolve(options.projectRoot)
  const targetIsDirectory = dependencies.targetIsDirectory ?? isDirectory
  if (!targetIsDirectory(projectRoot)) {
    return {
      status: 'failed',
      reason: 'Workbench can enable AAOP only inside an existing project directory.',
    }
  }

  const onboard = dependencies.resolveOnboarding ?? resolveProjectOnboarding
  const before = onboard(projectRoot)
  if (before.status === 'ready') {
    return { status: 'already-ready', onboarding: before }
  }
  if (before.status === 'blocked') {
    return { status: 'failed', reason: before.reason }
  }

  const pythonCommand = (
    dependencies.resolvePythonCommand
    ?? (() => resolveProjectPythonCommand({ workbenchRoot: options.workbenchRoot }))
  )()
  if (!pythonCommand) {
    return {
      status: 'failed',
      reason: 'Workbench cannot find a supported Python runtime required by AAOP setup.',
    }
  }

  let source: AaopStableSource
  try {
    source = await (dependencies.resolveStableSource ?? resolvePromotedAaopStableSource)()
  } catch (error) {
    return {
      status: 'failed',
      reason: `Workbench could not resolve the promoted AAOP stable source: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const runBootstrap = dependencies.runBootstrap ?? runCanonicalAaopBootstrap
  const completed = runBootstrap({
    projectRoot,
    pythonCommand,
    source,
  })
  if (completed.exitCode !== 0) {
    const details = (completed.stderr || completed.stdout || `exit ${completed.exitCode}`).trim()
    return {
      status: 'failed',
      sourceRevision: source.revision,
      aaopVersion: source.version,
      reason: `AAOP canonical bootstrap did not complete successfully: ${details}`,
    }
  }

  const after = onboard(projectRoot)
  if (after.status !== 'ready') {
    return {
      status: 'failed',
      sourceRevision: source.revision,
      aaopVersion: source.version,
      reason: `AAOP bootstrap completed, but Workbench onboarding is still ${after.status}: ${after.reason ?? 'no usable AAOP bridge was discovered'}`,
    }
  }
  if (after.aaopVersion && after.aaopVersion !== source.version) {
    return {
      status: 'failed',
      sourceRevision: source.revision,
      aaopVersion: source.version,
      reason: `AAOP setup release mismatch: expected ${source.version}, discovered ${after.aaopVersion}.`,
    }
  }

  return {
    status: 'installed',
    onboarding: after,
    sourceRevision: source.revision,
    aaopVersion: source.version,
  }
}
