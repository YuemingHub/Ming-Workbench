import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const WORKBENCH_PROJECT_MANIFEST = 'workbench.project.json' as const
export const WORKBENCH_PROJECT_SCHEMA_VERSION = '1.0' as const

export interface ProjectCommand {
  command: string
  args: string[]
  timeoutMs?: number
}

export interface ProjectAaopBridge {
  ready: ProjectCommand
  status: ProjectCommand
  prompt: ProjectCommand
}

export interface WorkbenchProjectManifest {
  schema_version: '1.0'
  project: {
    id: string
    title: string
    domain_pack: 'development-aaop'
  }
  development: {
    aaop_bridge: ProjectAaopBridge
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function assertCommand(name: string, value: unknown): asserts value is ProjectCommand {
  if (!value || typeof value !== 'object') {
    throw new Error(`workbench project manifest: ${name} must be an object`)
  }
  const command = value as Record<string, unknown>
  if (!isNonEmptyString(command.command)) {
    throw new Error(`workbench project manifest: ${name}.command is required`)
  }
  if (!Array.isArray(command.args) || !command.args.every(isNonEmptyString)) {
    throw new Error(`workbench project manifest: ${name}.args must be an array of non-empty strings`)
  }
  if (
    command.timeoutMs !== undefined
    && (!Number.isInteger(command.timeoutMs) || Number(command.timeoutMs) < 1)
  ) {
    throw new Error(`workbench project manifest: ${name}.timeoutMs must be a positive integer`)
  }
}

export function parseWorkbenchProjectManifest(value: unknown): WorkbenchProjectManifest {
  if (!value || typeof value !== 'object') {
    throw new Error('workbench project manifest must be an object')
  }
  const root = value as Record<string, unknown>
  if (root.schema_version !== WORKBENCH_PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `workbench project manifest: unsupported schema_version ${String(root.schema_version)}`,
    )
  }

  const project = root.project
  if (!project || typeof project !== 'object') {
    throw new Error('workbench project manifest: project is required')
  }
  const projectRecord = project as Record<string, unknown>
  if (!isNonEmptyString(projectRecord.id)) {
    throw new Error('workbench project manifest: project.id is required')
  }
  if (!isNonEmptyString(projectRecord.title)) {
    throw new Error('workbench project manifest: project.title is required')
  }
  if (projectRecord.domain_pack !== 'development-aaop') {
    throw new Error('workbench project manifest: only development-aaop is supported in P0')
  }

  const development = root.development
  if (!development || typeof development !== 'object') {
    throw new Error('workbench project manifest: development is required')
  }
  const bridge = (development as Record<string, unknown>).aaop_bridge
  if (!bridge || typeof bridge !== 'object') {
    throw new Error('workbench project manifest: development.aaop_bridge is required')
  }
  const bridgeRecord = bridge as Record<string, unknown>
  assertCommand('development.aaop_bridge.ready', bridgeRecord.ready)
  assertCommand('development.aaop_bridge.status', bridgeRecord.status)
  assertCommand('development.aaop_bridge.prompt', bridgeRecord.prompt)

  return value as WorkbenchProjectManifest
}

export function loadWorkbenchProjectManifest(projectRoot: string): WorkbenchProjectManifest {
  const path = resolve(projectRoot, WORKBENCH_PROJECT_MANIFEST)
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(
      `Unable to load ${WORKBENCH_PROJECT_MANIFEST} from ${resolve(projectRoot)}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  return parseWorkbenchProjectManifest(parsed)
}
