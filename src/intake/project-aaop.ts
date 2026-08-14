import { randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import type { WorkUnit } from '../core/model.js'
import {
  prepareDevelopmentIntake,
  type AaopDeveloperRequest,
} from '../domain-packs/development-aaop.js'
import {
  loadWorkbenchProjectManifest,
  type ProjectAaopBridge,
  type ProjectCommand,
  type WorkbenchProjectManifest,
} from '../projects/manifest.js'

export const DEFAULT_AAOP_INTAKE_BOUNDARY =
  'Read-only Developer Intake only. No repository mutation, branch creation, commit, push, deployment, credential use, paid external service, production effect, or real-user-data access is authorized by this intake request.' as const

export type AaopBridgeOperation = keyof ProjectAaopBridge

export interface ProjectCommandResult {
  operation: AaopBridgeOperation
  command: string
  args: string[]
  exitCode: number | null
  stdout: string
  stderr: string
  success: boolean
}

export interface ProjectAaopBridgeResult {
  ready: boolean
  readyResult: ProjectCommandResult
  statusResult?: ProjectCommandResult
  promptResult?: ProjectCommandResult
}

export interface PrepareProjectIntakeOptions {
  rawRequest: string
  projectRoot: string
  spaceId: string
  /** Selecting a workspace in Workbench is the future UI source of this trust bit. */
  trustedProject: boolean
  authorizationBoundary?: string
  manifest?: WorkbenchProjectManifest
  now?: () => Date
  idFactory?: () => string
}

export type PreparedProjectIntake =
  | {
      status: 'ready-for-aaop-coordinator'
      workUnit: WorkUnit
      manifest: WorkbenchProjectManifest
      aaopRequest: AaopDeveloperRequest
      bridge: ProjectAaopBridgeResult
      coordinatorMessage: string
    }
  | {
      status: 'project-aaop-blocked'
      workUnit: WorkUnit
      manifest: WorkbenchProjectManifest
      aaopRequest: AaopDeveloperRequest
      bridge: ProjectAaopBridgeResult
      reason: string
    }

const SAFE_PROJECT_ENV = [
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
  'PYTHON',
  'PYTHONHOME',
  'PYTHONPATH',
] as const

function projectCommandEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of SAFE_PROJECT_ENV) {
    const value = source[key]
    if (value !== undefined) env[key] = value
  }
  return env
}

function runProjectCommand(
  projectRoot: string,
  operation: AaopBridgeOperation,
  command: ProjectCommand,
): ProjectCommandResult {
  const result = spawnSync(command.command, command.args, {
    cwd: resolve(projectRoot),
    env: projectCommandEnv(process.env),
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: command.timeoutMs ?? 60_000,
    maxBuffer: 2 * 1024 * 1024,
  })

  const stderr = [
    result.stderr ?? '',
    result.error ? String(result.error.message ?? result.error) : '',
  ].filter(Boolean).join('\n').trim()

  return {
    operation,
    command: command.command,
    args: [...command.args],
    exitCode: result.status,
    stdout: (result.stdout ?? '').trim(),
    stderr,
    success: result.status === 0 && result.error === undefined,
  }
}

export function runProjectAaopBridge(
  projectRoot: string,
  manifest: WorkbenchProjectManifest,
  trustedProject: boolean,
): ProjectAaopBridgeResult {
  if (!trustedProject) {
    throw new Error(
      'Refusing to execute repository-declared AAOP bridge commands before the workspace is trusted.',
    )
  }

  const bridge = manifest.development.aaop_bridge
  const readyResult = runProjectCommand(projectRoot, 'ready', bridge.ready)
  if (!readyResult.success) {
    return { ready: false, readyResult }
  }

  const statusResult = runProjectCommand(projectRoot, 'status', bridge.status)
  if (!statusResult.success) {
    return { ready: false, readyResult, statusResult }
  }

  const promptResult = runProjectCommand(projectRoot, 'prompt', bridge.prompt)
  if (!promptResult.success) {
    return { ready: false, readyResult, statusResult, promptResult }
  }

  return { ready: true, readyResult, statusResult, promptResult }
}

function titleFromRequest(rawRequest: string): string {
  const collapsed = rawRequest.trim().replace(/\s+/g, ' ')
  if (collapsed.length <= 72) return collapsed
  return `${collapsed.slice(0, 69)}...`
}

export function createIntakeWorkUnit(
  rawRequest: string,
  spaceId: string,
  now: () => Date = () => new Date(),
  idFactory: () => string = () => randomUUID(),
): WorkUnit {
  const request = rawRequest.trim()
  if (!request) throw new Error('Cannot create a development Work Unit from an empty request.')
  const timestamp = now().toISOString()

  return {
    id: `WU-${idFactory()}`,
    spaceId,
    title: titleFromRequest(request),
    outcome: request,
    state: 'intake',
    owner: 'development-aaop',
    gate: { kind: 'none', open: false },
    acceptance: [],
    evidence: [],
    assets: [],
    nextFrontier: 'Ground the request through the project AAOP Developer Intake bridge.',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function renderProjectAaopCoordinatorMessage(
  aaopRequest: AaopDeveloperRequest,
  manifest: WorkbenchProjectManifest,
  bridge: ProjectAaopBridgeResult,
): string {
  if (!bridge.ready || !bridge.statusResult || !bridge.promptResult) {
    throw new Error('Cannot render an AAOP coordinator message from an unready project bridge.')
  }

  return [
    '[MING_WORKBENCH_AAOP_DEVELOPER_INTAKE_REQUEST]',
    'This is a read-only grounded Developer Intake request. It is not an AAOP canonical Intake Envelope and authorizes no mutation.',
    'AAOP remains responsible for Situation, Route, route confidence, ambiguities, human-owned questions, provider selection, Task Pod decisions, execution scope, and engineering acceptance.',
    'Inspect current project evidence before deciding. Do not ask the human to name implementation files when repository evidence can answer that question.',
    '',
    JSON.stringify({
      workbench_request: aaopRequest,
      project: manifest.project,
      project_bridge: {
        status: bridge.statusResult.stdout,
        prompt: bridge.promptResult.stdout,
      },
    }, null, 2),
    '[/MING_WORKBENCH_AAOP_DEVELOPER_INTAKE_REQUEST]',
  ].join('\n')
}

export function prepareProjectDevelopmentIntake(
  options: PrepareProjectIntakeOptions,
): PreparedProjectIntake {
  const projectRoot = resolve(options.projectRoot)
  const manifest = options.manifest ?? loadWorkbenchProjectManifest(projectRoot)
  const workUnit = createIntakeWorkUnit(
    options.rawRequest,
    options.spaceId,
    options.now,
    options.idFactory,
  )
  const preparation = prepareDevelopmentIntake({
    unit: workUnit,
    rawRequest: options.rawRequest,
    authorizationBoundary:
      options.authorizationBoundary ?? DEFAULT_AAOP_INTAKE_BOUNDARY,
  })
  const bridge = runProjectAaopBridge(projectRoot, manifest, options.trustedProject)

  if (!bridge.ready) {
    const failed = bridge.promptResult ?? bridge.statusResult ?? bridge.readyResult
    workUnit.state = 'blocked'
    workUnit.nextFrontier =
      'Repair or deliberately prepare the project AAOP bridge, then retry grounded Developer Intake.'
    workUnit.updatedAt = (options.now ?? (() => new Date()))().toISOString()

    return {
      status: 'project-aaop-blocked',
      workUnit,
      manifest,
      aaopRequest: preparation.aaopRequest,
      bridge,
      reason: [
        `Project AAOP bridge ${failed.operation} command did not succeed.`,
        failed.stderr || failed.stdout || 'No diagnostic output was produced.',
      ].join(' '),
    }
  }

  return {
    status: 'ready-for-aaop-coordinator',
    workUnit,
    manifest,
    aaopRequest: preparation.aaopRequest,
    bridge,
    coordinatorMessage: renderProjectAaopCoordinatorMessage(
      preparation.aaopRequest,
      manifest,
      bridge,
    ),
  }
}
