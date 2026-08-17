/**
 * Harness runtime preparation: bundled extraction + identity verification.
 *
 * Normal users should not need to manually clone or set MING_HARNESS_CHECKOUT.
 * This module tries, in order:
 *   1. MING_HARNESS_CHECKOUT env var (backward-compat escape hatch)
 *   2. An explicit harnessCheckout path supplied by the caller
 *   3. A bundled git bundle shipped with the Workbench package
 *
 * The bundled path is extracted to a platform cache directory, identity-
 * verified against harness.lock.json, and dependencies installed.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'

export interface HarnessRuntimeOptions {
  workbenchRoot: string
  harnessCheckout?: string
  lock?: {
    reviewedCommit: string
    sourcePackage: { version: string; path: string }
    upstreamRepository: string
  }
}

export interface HarnessRuntimeResult {
  checkout: string
  source: 'bundled' | 'env' | 'existing'
  identity: { commit: string; version: string }
}

const BUNDLE_NAME = 'deepseek-harness-0.1.0-rc.5.bundle'

function defaultLockPath(workbenchRoot: string): string {
  return resolve(workbenchRoot, 'harness.lock.json')
}

function defaultBundlePath(workbenchRoot: string): string {
  return resolve(workbenchRoot, '.workbench', 'vendor', BUNDLE_NAME)
}

function defaultBundledRuntimeDir(workbenchRoot: string): string {
  // Extract under a SHORT per-user cache directory, not under workbenchRoot.
  // On Windows, the packaged app's resources path is deep enough that pnpm's
  // .pnpm virtual store exceeds MAX_PATH (260) and the native install/copy
  // fails. os.tmpdir() is short and writable for a per-user install.
  // MING_HARNESS_CACHE is a diagnostic override for tests/operators.
  const cacheRoot = process.env.MING_HARNESS_CACHE
    ? resolve(process.env.MING_HARNESS_CACHE)
    : join(tmpdir(), 'ming-workbench-harness')
  return join(cacheRoot, 'deepseek-harness')
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function gitExists(cwd: string): boolean {
  try {
    git(cwd, ['rev-parse', '--git-dir'])
    return true
  } catch {
    return false
  }
}

function readLock(workbenchRoot: string): {
  reviewedCommit: string
  sourcePackage: { version: string; path: string }
  upstreamRepository: string
} {
  const raw = readFileSync(defaultLockPath(workbenchRoot), 'utf8')
  const parsed = JSON.parse(raw)
  if (
    !parsed ||
    typeof parsed.reviewedCommit !== 'string' ||
    !parsed.sourcePackage ||
    typeof parsed.sourcePackage.version !== 'string' ||
    typeof parsed.sourcePackage.path !== 'string' ||
    typeof parsed.upstreamRepository !== 'string'
  ) {
    throw new Error('harness.lock.json is missing required reviewed source identity.')
  }
  return parsed as {
    reviewedCommit: string
    sourcePackage: { version: string; path: string }
    upstreamRepository: string
  }
}

function verifyIdentity(checkout: string, lock: {
  reviewedCommit: string
  sourcePackage: { version: string; path: string }
}): { commit: string; version: string } {
  const commit = git(checkout, ['rev-parse', 'HEAD'])
  const pkg = JSON.parse(
    readFileSync(join(checkout, lock.sourcePackage.path), 'utf8'),
  ) as { version?: unknown }

  if (commit !== lock.reviewedCommit) {
    throw new Error(
      `Harness identity mismatch: expected commit ${lock.reviewedCommit}, detected ${commit}.`,
    )
  }
  if (typeof pkg.version !== 'string' || pkg.version !== lock.sourcePackage.version) {
    throw new Error(
      `Harness identity mismatch: expected version ${lock.sourcePackage.version}, detected ${pkg.version}.`,
    )
  }

  return { commit, version: pkg.version }
}

function assertSupportedNode(): void {
  const [major, minor] = process.versions.node.split('.').map(Number)
  const supported = major >= 24 || (major === 22 && minor >= 19)
  if (!supported) {
    throw new Error(
      `DeepSeek Harness requires Node ^22.19.0 or >=24; detected ${process.version}.`,
    )
  }
}

/** Diagnostic tails are bounded so failures never dump unbounded output. */
const DIAGNOSTIC_TAIL_LIMIT = 4000

export interface PnpmInvocation {
  executable: string
  args: string[]
  env: Record<string, string>
  shell: boolean
  kind: 'electron-process-exec' | 'node' | 'npx'
}

/**
 * Resolves the exact pnpm invocation for a Harness checkout so the packaged
 * desktop failure can be diagnosed and tested as a plain configuration
 * builder. Env additions are scoped to the returned invocation only; the
 * caller's process.env is never mutated.
 */
export function resolvePnpmInvocation(workbenchRoot: string, checkout: string): PnpmInvocation {
  // Use the bundled pnpm package (dependency of Ming Workbench) instead of
  // requiring the user to have npx or pnpm installed globally. In a packaged
  // desktop app, the bundled pnpm is in node_modules; in dev mode it is too.
  const pnpmBin = resolve(workbenchRoot, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
  const pnpmArgs = [
    '--dir', checkout,
    'install',
    '--no-frozen-lockfile',
    '--config.node-linker=hoisted',
  ]
  const env: Record<string, string> = {
    ...process.env,
    // Ensure pnpm's store is writable for per-user installs.
    PNPM_HOME: process.env.PNPM_HOME ?? join(workbenchRoot, '.workbench', 'pnpm-store'),
  }

  if (existsSync(pnpmBin)) {
    const executable = process.execPath
    return {
      executable,
      args: [pnpmBin, ...pnpmArgs],
      env: {
        ...env,
        // The packaged main process is the Electron app binary. It only runs
        // the bundled pnpm script when told to act as Node; the flag is
        // scoped to this child, never the app's own environment.
        ELECTRON_RUN_AS_NODE: '1',
      },
      // Never route the app binary through cmd.exe: its path contains spaces
      // and cmd mis-quotes them, so the install fails before pnpm runs.
      shell: false,
      kind: executableKind(executable),
    }
  }

  // Fallback: npx (dev/CI environments that already have pnpm globally).
  // npx.cmd on Windows can only be executed through a shell.
  const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  return {
    executable,
    args: ['-y', 'pnpm@11.7.0', ...pnpmArgs],
    env,
    shell: process.platform === 'win32',
    kind: 'npx',
  }
}

export function executableKind(executable: string): PnpmInvocation['kind'] {
  const base = basename(executable).toLowerCase()
  if (base === 'node' || base === 'node.exe') return 'node'
  if (base === 'npx' || base === 'npx.cmd') return 'npx'
  return 'electron-process-exec'
}

/** Env var names whose values must never reach a diagnostic. */
const SECRET_ENV_NAME_RE = /(?:api[_-]?key|token|secret|passwd|password|credential)/i

/** Well-known credential shapes, redacted from diagnostics regardless of env. */
const CREDENTIAL_SHAPE_RES: Array<[RegExp, string]> = [
  [/sk-[A-Za-z0-9_-]{12,}/g, '[REDACTED-API-KEY]'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/g, '[REDACTED-TOKEN]'],
  [/AIza[0-9A-Za-z_-]{20,}/g, '[REDACTED-API-KEY]'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/g, '[REDACTED-TOKEN]'],
]

/**
 * Scrubs secret-bearing env values and credential-shaped strings out of
 * diagnostic text. Only this sanitized text may be logged.
 */
export function sanitizeDiagnosticText(text: string): string {
  let out = String(text ?? '')
  for (const name of Object.keys(process.env)) {
    if (!SECRET_ENV_NAME_RE.test(name)) continue
    const value = process.env[name]
    if (value && out.includes(value)) {
      out = out.split(value).join(`[REDACTED:${name}]`)
    }
  }
  for (const [pattern, placeholder] of CREDENTIAL_SHAPE_RES) {
    out = out.replace(pattern, placeholder)
  }
  return out
}

function boundedTail(text: string): string {
  const value = String(text ?? '')
  if (value.length <= DIAGNOSTIC_TAIL_LIMIT) return value
  return `[${value.length - DIAGNOSTIC_TAIL_LIMIT} chars truncated]${value.slice(-DIAGNOSTIC_TAIL_LIMIT)}`
}

function describePnpmFailure(invocation: PnpmInvocation, error: unknown): string {
  const err = error as { status?: number | null; code?: string; stderr?: unknown; stdout?: unknown }
  const exit = err?.status != null ? String(err.status) : (err?.code ?? 'unknown')
  const stderr = sanitizeDiagnosticText(boundedTail(String(err?.stderr ?? '')))
  const stdout = sanitizeDiagnosticText(boundedTail(String(err?.stdout ?? '')))

  const lines = [
    `PNPM_EXECUTABLE_KIND: ${invocation.kind}`,
    `PROCESS_EXEC_PATH: ${basename(invocation.executable)}`,
    `ELECTRON_RUN_AS_NODE: ${invocation.env.ELECTRON_RUN_AS_NODE === '1' ? 'present' : 'absent'}`,
    `EXIT_CODE: ${exit}`,
  ]
  if (stderr) lines.push(`STDERR_TAIL: ${stderr}`)
  if (!stderr && stdout) lines.push(`STDOUT_TAIL: ${stdout}`)
  return `\n${lines.join('\n')}`
}

function installDependencies(checkout: string, workbenchRoot: string): void {
  assertSupportedNode()

  const invocation = resolvePnpmInvocation(workbenchRoot, checkout)
  try {
    execFileSync(invocation.executable, invocation.args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: invocation.shell,
      env: invocation.env,
      // The install can print a lot; never let a noisy-but-successful run
      // look like a failure because the pipe buffer filled.
      maxBuffer: 16 * 1024 * 1024,
    })
  } catch (error) {
    throw new Error(
      `Harness dependency installation failed in ${checkout}.${describePnpmFailure(invocation, error)}`,
    )
  }
}

function extractBundle(bundlePath: string, targetDir: string): void {
  if (!existsSync(bundlePath)) {
    throw new Error(`Harness runtime bundle not found at ${bundlePath}.`)
  }
  mkdirSync(dirname(targetDir), { recursive: true })
  try {
    execFileSync('git', ['clone', bundlePath, targetDir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    throw new Error(
      `Failed to extract Harness runtime bundle to ${targetDir}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
}

function isGitDir(cwd: string): boolean {
  try {
    execFileSync('git', ['-C', cwd, 'rev-parse', '--git-dir'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return true
  } catch {
    return false
  }
}

function removeDir(dir: string): void {
  if (!existsSync(dir)) return
  try {
    // rmSync removes symlinks/junctions on Windows and retries transient
    // locks. A leftover partial bundle extraction must never silently survive
    // cleanup, or the next `git clone` fails with "already exists".
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 })
  } catch {
    // Best-effort cleanup; the caller verifies the directory is gone before
    // extracting and surfaces a clear error when it is not.
  }
}

export async function prepareHarnessRuntime(
  options: HarnessRuntimeOptions,
): Promise<HarnessRuntimeResult> {
  const workbenchRoot = resolve(options.workbenchRoot)
  const lock = options.lock ?? readLock(workbenchRoot)

  // 1. Env var escape hatch (backward compat).
  const envCheckout = process.env.MING_HARNESS_CHECKOUT?.trim()
  if (envCheckout) {
    const checkout = resolve(envCheckout)
    if (!existsSync(checkout) || !gitExists(checkout)) {
      throw new Error(
        `MING_HARNESS_CHECKOUT points to a missing or non-Git path: ${checkout}`,
      )
    }
    const identity = verifyIdentity(checkout, lock)
    return { checkout, source: 'env', identity }
  }

  // 2. Explicit path from caller.
  const explicitCheckout = options.harnessCheckout?.trim()
  if (explicitCheckout) {
    const checkout = resolve(explicitCheckout)
    if (!existsSync(checkout) || !gitExists(checkout)) {
      throw new Error(
        `Harness checkout path does not exist or is not a Git repo: ${checkout}`,
      )
    }
    const identity = verifyIdentity(checkout, lock)
    return { checkout, source: 'existing', identity }
  }

  // 3. Bundled runtime.
  const bundlePath = defaultBundlePath(workbenchRoot)
  const bundledDir = defaultBundledRuntimeDir(workbenchRoot)

  // If the bundled runtime already exists and is valid, reuse it.
  if (isGitDir(bundledDir)) {
    try {
      const identity = verifyIdentity(bundledDir, lock)
      return { checkout: bundledDir, source: 'bundled', identity }
    } catch {
      // Stale or corrupted — remove and re-extract.
    }
  }

  // Extract fresh from bundle.
  if (!existsSync(bundlePath)) {
    throw new Error(
      `Harness runtime bundle not found at ${bundlePath}. Run \`npm run harness:prepare\` to provision the reviewed runtime.`,
    )
  }

  // Clean target if it exists but isn't a valid Git repo.
  if (existsSync(bundledDir)) {
    removeDir(bundledDir)
  }
  if (existsSync(bundledDir)) {
    throw new Error(
      `Harness runtime directory ${bundledDir} could not be removed for a fresh extraction. Close any process holding it and retry.`,
    )
  }

  extractBundle(bundlePath, bundledDir)
  const identity = verifyIdentity(bundledDir, lock)
  installDependencies(bundledDir, workbenchRoot)

  return { checkout: bundledDir, source: 'bundled', identity }
}
