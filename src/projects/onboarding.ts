import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import {
  WORKBENCH_PROJECT_MANIFEST,
  parseWorkbenchProjectManifest,
  type WorkbenchProjectManifest,
} from './manifest.js'
import { resolveProductPythonCommand } from './python-runtime.js'

export interface ProjectOnboardingIdentity {
  id: string
  title: string
  root: string
  domainPackId: 'development-aaop'
}

export type ProjectOnboardingReadySource =
  | 'workbench-manifest'
  | 'installed-aaop'
  | 'legacy-aaop'

export type ProjectOnboardingResult =
  | {
      status: 'ready'
      project: ProjectOnboardingIdentity
      manifest: WorkbenchProjectManifest
      source: ProjectOnboardingReadySource
      aaopVersion?: string
      pythonCommand?: string
    }
  | {
      status: 'setup-required'
      project: ProjectOnboardingIdentity
      reason: string
    }
  | {
      status: 'blocked'
      project: ProjectOnboardingIdentity
      reason: string
    }

export interface ProjectOnboardingDependencies {
  exists?: (path: string) => boolean
  readText?: (path: string) => string
  commandAvailable?: (command: string) => boolean
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  /** Packaged root that may carry a bundled Python runtime. */
  workbenchRoot?: string
}

const AAOP_ORCHESTRATOR_IDENTITY = '# AAOP Runtime Protocol'
const AAOP_MANIFEST_NAME = '.install-manifest.json'
const AAOP_TOOL_RELATIVE = '.aaop/tools/aaop.py'

function readUtf8(path: string): string {
  return readFileSync(path, 'utf8')
}

function defaultCommandAvailable(command: string): boolean {
  const result = spawnSync(command, ['--version'], {
    stdio: 'ignore',
    shell: false,
    windowsHide: true,
    timeout: 5_000,
  })
  return result.error === undefined && result.status === 0
}

function uniqueNonEmpty(values: Array<string | undefined>): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    const normalized = value?.trim()
    if (!normalized || seen.has(normalized)) continue
    seen.add(normalized)
    result.push(normalized)
  }
  return result
}

export function resolveProjectPythonCommand(
  dependencies: ProjectOnboardingDependencies = {},
): string | undefined {
  const platform = dependencies.platform ?? process.platform
  const env = dependencies.env ?? process.env
  const commandAvailable = dependencies.commandAvailable ?? defaultCommandAvailable

  // Packaged product path: a bundled, hash-verified Python runtime wins over
  // any system Python. Consumers must not install Python.
  if (dependencies.workbenchRoot) {
    const bundled = resolveProductPythonCommand(dependencies.workbenchRoot, platform)
    if (bundled) return bundled
  }

  const candidates = uniqueNonEmpty([
    env.PYTHON,
    ...(platform === 'win32'
      ? ['py', 'python']
      : ['python3', 'python']),
  ])
  return candidates.find((command) => commandAvailable(command))
}

function localProjectIdentity(projectRoot: string): ProjectOnboardingIdentity {
  const root = resolve(projectRoot)
  const title = basename(root) || 'Local Project'
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36) || 'project'
  const digest = createHash('sha256').update(root).digest('hex').slice(0, 12)
  return {
    id: `local-${slug}-${digest}`,
    title,
    root,
    domainPackId: 'development-aaop',
  }
}

function manifestProjectIdentity(
  projectRoot: string,
  manifest: WorkbenchProjectManifest,
): ProjectOnboardingIdentity {
  return {
    id: manifest.project.id,
    title: manifest.project.title,
    root: resolve(projectRoot),
    domainPackId: 'development-aaop',
  }
}

function deriveInstalledAaopManifest(
  identity: ProjectOnboardingIdentity,
  pythonCommand: string,
): WorkbenchProjectManifest {
  const command = (operation: 'ready' | 'status' | 'prompt') => ({
    command: pythonCommand,
    args: operation === 'prompt'
      ? [AAOP_TOOL_RELATIVE, operation]
      : [AAOP_TOOL_RELATIVE, operation, '.'],
    timeoutMs: 60_000,
  })

  return {
    schema_version: '1.0',
    project: {
      id: identity.id,
      title: identity.title,
      domain_pack: 'development-aaop',
    },
    development: {
      aaop_bridge: {
        ready: command('ready'),
        status: command('status'),
        prompt: command('prompt'),
      },
    },
  }
}

function parseInstalledManifest(
  text: string,
): { aaopVersion: string; files: Record<string, unknown> } | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!value || typeof value !== 'object') return undefined
  const root = value as Record<string, unknown>
  if (root.managed_by !== 'AAOP installer') return undefined
  if (!Number.isInteger(root.schema_version) || Number(root.schema_version) < 1) return undefined
  if (typeof root.aaop_version !== 'string' || !root.aaop_version.trim()) return undefined
  if (!root.files || typeof root.files !== 'object' || Array.isArray(root.files)) return undefined
  return {
    aaopVersion: root.aaop_version.trim(),
    files: root.files as Record<string, unknown>,
  }
}

function installedAaopBlocked(
  identity: ProjectOnboardingIdentity,
  detail: string,
): ProjectOnboardingResult {
  return {
    status: 'blocked',
    project: identity,
    reason: `Workbench found an .aaop directory but cannot prove a usable AAOP installation: ${detail} Workbench will not overwrite or repair it automatically.`,
  }
}

/**
 * Discover how a local project should enter Ming Workbench without making the
 * human author Workbench plumbing.
 *
 * Precedence:
 * 1. explicit workbench.project.json;
 * 2. recognizable installed AAOP, from which Workbench derives an in-memory bridge;
 * 3. setup-required when AAOP is absent.
 *
 * Discovery is read-only. It never installs AAOP or mutates project state.
 */
export function resolveProjectOnboarding(
  projectRoot: string,
  dependencies: ProjectOnboardingDependencies = {},
): ProjectOnboardingResult {
  const root = resolve(projectRoot)
  const exists = dependencies.exists ?? existsSync
  const readText = dependencies.readText ?? readUtf8
  const localIdentity = localProjectIdentity(root)
  const workbenchManifestPath = join(root, WORKBENCH_PROJECT_MANIFEST)

  if (exists(workbenchManifestPath)) {
    try {
      const parsed = parseWorkbenchProjectManifest(JSON.parse(readText(workbenchManifestPath)))
      return {
        status: 'ready',
        project: manifestProjectIdentity(root, parsed),
        manifest: parsed,
        source: 'workbench-manifest',
      }
    } catch (error) {
      return {
        status: 'blocked',
        project: localIdentity,
        reason: `Workbench project configuration exists but is invalid: ${error instanceof Error ? error.message : String(error)}`,
      }
    }
  }

  const aaopRoot = join(root, '.aaop')
  if (!exists(aaopRoot)) {
    return {
      status: 'setup-required',
      project: localIdentity,
      reason: 'This project is not yet enabled for grounded Workbench development. Enable AAOP once, then Workbench can continue from ordinary language without manual project configuration.',
    }
  }

  const orchestratorPath = join(aaopRoot, 'ORCHESTRATOR.md')
  const versionPath = join(aaopRoot, 'VERSION')
  const toolPath = join(root, AAOP_TOOL_RELATIVE)
  if (!exists(orchestratorPath) || !exists(versionPath) || !exists(toolPath)) {
    return installedAaopBlocked(localIdentity, 'required AAOP runtime files are missing.')
  }

  let orchestrator: string
  let version: string
  try {
    orchestrator = readText(orchestratorPath)
    version = readText(versionPath).trim()
  } catch (error) {
    return installedAaopBlocked(
      localIdentity,
      `required AAOP runtime files cannot be read: ${error instanceof Error ? error.message : String(error)}.`,
    )
  }
  if (!orchestrator.includes(AAOP_ORCHESTRATOR_IDENTITY) || !version) {
    return installedAaopBlocked(localIdentity, 'the AAOP runtime identity or release identity is not recognizable.')
  }

  const installManifestPath = join(aaopRoot, AAOP_MANIFEST_NAME)
  let source: ProjectOnboardingReadySource = 'legacy-aaop'
  if (exists(installManifestPath)) {
    let installed
    try {
      installed = parseInstalledManifest(readText(installManifestPath))
    } catch {
      installed = undefined
    }
    if (!installed) {
      return installedAaopBlocked(localIdentity, 'the AAOP installer ownership manifest is invalid.')
    }
    for (const required of ['ORCHESTRATOR.md', 'VERSION', 'tools/aaop.py']) {
      if (!(required in installed.files)) {
        return installedAaopBlocked(localIdentity, `the AAOP ownership manifest does not claim ${required}.`)
      }
    }
    if (installed.aaopVersion !== version) {
      return installedAaopBlocked(
        localIdentity,
        `the installed AAOP release identity (${version}) does not match its ownership manifest (${installed.aaopVersion}).`,
      )
    }
    source = 'installed-aaop'
  }

  const pythonCommand = resolveProjectPythonCommand(dependencies)
  if (!pythonCommand) {
    return {
      status: 'blocked',
      project: localIdentity,
      reason: 'AAOP is installed, but Workbench cannot find a usable Python command for the project AAOP tools.',
    }
  }

  return {
    status: 'ready',
    project: localIdentity,
    manifest: deriveInstalledAaopManifest(localIdentity, pythonCommand),
    source,
    aaopVersion: version,
    pythonCommand,
  }
}
