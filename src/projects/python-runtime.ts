/**
 * Bundled Python runtime for AAOP canonical bootstrap.
 *
 * Product constraint: a consumer using Ming Workbench must NOT be required to
 * install Python. AAOP's canonical bootstrap (bootstrap.py + install.py +
 * provenance.py) is intentionally stdlib-only, so it runs on a stock CPython
 * without pip packages. We ship a pinned, hash-verified CPython runtime and
 * prefer it before falling back to a system Python for developer machines.
 *
 * Authority boundary:
 * - We do NOT reimplement AAOP lifecycle semantics. We only provide the
 *   interpreter that runs the canonical bootstrap.
 * - The Python runtime is a pinned official distribution (python.org Windows
 *   embeddable, or a system Python on POSIX dev boxes) whose identity is
 *   recorded in python-runtime.json.
 * - A system Python is never silently preferred over the bundled one in a
 *   packaged app; the bundled interpreter is authoritative.
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

export interface PythonRuntimeIdentity {
  version: string
  platform: string
  source: string
  sha256?: string
}

export interface BundledPythonRuntime {
  /** Absolute path to the interpreter executable, or undefined when absent. */
  executable: string | undefined
  identity: PythonRuntimeIdentity | undefined
}

export function defaultBundledPythonDir(workbenchRoot: string): string {
  return resolve(workbenchRoot, '.workbench', 'runtime', 'python')
}

function pythonRuntimeIdentityPath(workbenchRoot: string): string {
  return join(defaultBundledPythonDir(workbenchRoot), 'python-runtime.json')
}

function sha256File(file: string): string {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

/**
 * Resolve the bundled Python runtime shipped with a packaged Workbench.
 *
 * The bundled directory is a pinned official distribution prepared at build
 * time. Its identity manifest records version/platform/source and the SHA-256
 * of the interpreter binary; we re-verify the interpreter each time so a
 * corrupted runtime is never silently executed.
 */
export function resolveBundledPythonRuntime(
  workbenchRoot: string,
): BundledPythonRuntime {
  const dir = defaultBundledPythonDir(workbenchRoot)
  const identityPath = pythonRuntimeIdentityPath(workbenchRoot)
  if (!existsSync(identityPath)) {
    return { executable: undefined, identity: undefined }
  }

  let identity: PythonRuntimeIdentity
  try {
    identity = JSON.parse(readFileSync(identityPath, 'utf8')) as PythonRuntimeIdentity
  } catch {
    return { executable: undefined, identity: undefined }
  }

  const candidates = process.platform === 'win32'
    ? [join(dir, 'python', 'python.exe')]
    : [join(dir, 'bin', 'python3')]
  const executable = candidates.find((candidate) => existsSync(candidate))

  if (!executable) {
    return { executable: undefined, identity }
  }

  if (identity.sha256) {
    const actual = sha256File(executable)
    if (actual !== identity.sha256) {
      return { executable: undefined, identity }
    }
  }

  return { executable, identity }
}

/** Pure command-availability probe used by onboarding (no side effects). */
function commandAvailable(command: string): boolean {
  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore',
    shell: false,
    windowsHide: true,
    timeout: 5_000,
  })
  return result.error === undefined && result.status === 0
}

/**
 * Resolve the Python command for AAOP bridge commands. Packaged apps use the
 * bundled interpreter; developer machines fall back to a system Python.
 *
 * The returned command is safe to pass to spawnSync (absolute path for bundled,
 * bare command for system Python).
 */
export function resolveProductPythonCommand(
  workbenchRoot: string,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const bundled = resolveBundledPythonRuntime(workbenchRoot)
  if (bundled.executable) return bundled.executable

  const candidates = platform === 'win32'
    ? ['py', 'python']
    : ['python3', 'python']
  for (const candidate of candidates) {
    if (commandAvailable(candidate)) return candidate
  }
  return undefined
}
