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
import { join, resolve, dirname } from 'node:path'

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
  return resolve(workbenchRoot, '.workbench', 'runtime', 'deepseek-harness')
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

function installDependencies(checkout: string, workbenchRoot: string): void {
  assertSupportedNode()

  // Use the bundled pnpm package (dependency of Ming Workbench) instead of
  // requiring the user to have npx or pnpm installed globally. In a packaged
  // desktop app, the bundled pnpm is in node_modules; in dev mode it is too.
  const pnpmDir = resolve(workbenchRoot, 'node_modules', 'pnpm')
  const pnpmBin = process.platform === 'win32'
    ? resolve(pnpmDir, 'bin', 'pnpm.cjs')
    : resolve(pnpmDir, 'bin', 'pnpm.cjs')

  let pnpmExecutable: string
  let pnpmArgs: string[]
  if (existsSync(pnpmBin)) {
    pnpmExecutable = process.execPath
    pnpmArgs = [pnpmBin, '--dir', checkout, 'install', '--no-frozen-lockfile', '--config.node-linker=hoisted']
  } else {
    // Fallback: npx (dev/CI environments that already have pnpm globally).
    pnpmExecutable = process.platform === 'win32' ? 'npx.cmd' : 'npx'
    pnpmArgs = ['-y', 'pnpm@11.7.0', '--dir', checkout, 'install', '--no-frozen-lockfile', '--config.node-linker=hoisted']
  }

  try {
    execFileSync(pnpmExecutable, pnpmArgs, {
      encoding: 'utf8',
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        // Ensure pnpm's store is writable for per-user installs.
        PNPM_HOME: process.env.PNPM_HOME ?? join(workbenchRoot, '.workbench', 'pnpm-store'),
      },
    })
  } catch {
    throw new Error(`Harness dependency installation failed in ${checkout}.`)
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
