import type { WorkUnit } from '../core/model.js'

export const AAOP_PROVIDER_EXECUTION_GRANT_SCHEMA_VERSION = '1.0' as const
export const AAOP_PROVIDER_EXECUTION_GRANT_SCHEMA_URI =
  'https://aaop.dev/schemas/provider-execution-grant.schema.json' as const

export type AaopRoute =
  | 'idea-to-build'
  | 'repo-recovery'
  | 'bug-fix'
  | 'feature-change'
  | 'understand-review'
  | 'release-operations'

export interface ProviderExecutionTask {
  id: string
  owner?: string
  depends_on?: string[]
  inputs?: string[]
  action: string
  expected_output?: string
  verification: string[]
  failure_path: string
}

export interface ProviderWriteTarget {
  repository: string
  base_ref: string
  working_ref: string
  environment?: string | null
}

export interface ProviderAuthorization {
  mutation_boundary: 'read-only' | 'write-authorized'
  write_target: ProviderWriteTarget | null
  allowed_effects: string[]
  protected_effects: string[]
}

export interface ProviderTaskPod {
  pod_id: string
  accountable_owner: string
  members: string[]
}

/**
 * Workbench consumer view of AAOP's Provider Execution Grant schema.
 * The canonical schema is owned by AAOP, not by this repository.
 */
export interface ProviderExecutionGrant {
  schema_version: '1.0'
  grant_id: string
  work_unit_ref?: string | null
  provider: string
  route: AaopRoute
  working_contract_revision: number
  goal: string
  baseline: string[]
  execution_mode: 'single-agent' | 'task-pod'
  task_pod?: ProviderTaskPod | null
  tasks: ProviderExecutionTask[]
  authorization: ProviderAuthorization
  acceptance_evidence: string[]
  human_open_questions: string[]
  references: string[]
  issued_at: string
}

export interface GrantValidationResult {
  valid: boolean
  issues: string[]
}

/**
 * Validate the subset of the canonical AAOP grant contract that is load-bearing
 * for Workbench's current single-agent DeepSeek Harness execution profile.
 */
export function validateHarnessExecutionGrant(
  grant: ProviderExecutionGrant,
  workUnit?: WorkUnit,
): GrantValidationResult {
  const issues: string[] = []

  if (grant.schema_version !== AAOP_PROVIDER_EXECUTION_GRANT_SCHEMA_VERSION) {
    issues.push(`unsupported grant schema version: ${grant.schema_version}`)
  }
  if (!grant.grant_id.trim()) issues.push('grant_id is required')
  if (grant.provider !== 'deepseek-harness') {
    issues.push(`provider must be deepseek-harness, received ${grant.provider}`)
  }
  if (!Number.isInteger(grant.working_contract_revision) || grant.working_contract_revision < 1) {
    issues.push('working_contract_revision must be a positive integer')
  }
  if (!grant.goal.trim()) issues.push('goal is required')
  if (grant.tasks.length === 0) issues.push('at least one bounded task is required')
  if (grant.acceptance_evidence.length === 0) {
    issues.push('acceptance_evidence must not be empty')
  }
  if (grant.human_open_questions.length > 0) {
    issues.push('execution grant cannot carry unresolved human-owned questions')
  }

  if (grant.execution_mode !== 'single-agent') {
    issues.push(
      'development-aaop Harness preset is single-agent; a task-pod grant requires a separately authorized execution profile',
    )
  }
  if (grant.task_pod != null) {
    issues.push('single-agent Harness grant must not carry task_pod configuration')
  }

  if (grant.authorization.mutation_boundary === 'read-only') {
    if (grant.authorization.write_target !== null) {
      issues.push('read-only grant must have write_target = null')
    }
  } else {
    const target = grant.authorization.write_target
    if (target === null) {
      issues.push('write-authorized grant requires an exact write_target')
    } else {
      if (!target.repository.trim()) issues.push('write_target.repository is required')
      if (!target.base_ref.trim()) issues.push('write_target.base_ref is required')
      if (!target.working_ref.trim()) issues.push('write_target.working_ref is required')
    }
  }

  for (const task of grant.tasks) {
    if (!task.id.trim()) issues.push('every task needs an id')
    if (!task.action.trim()) issues.push(`task ${task.id || '<unknown>'} needs an action`)
    if (!task.failure_path.trim()) {
      issues.push(`task ${task.id || '<unknown>'} needs a failure_path`)
    }
  }

  if (workUnit) {
    if (!grant.work_unit_ref) {
      issues.push('grant must carry work_unit_ref when reconciling to a Work Unit')
    } else if (grant.work_unit_ref !== workUnit.id) {
      issues.push(
        `grant work_unit_ref ${grant.work_unit_ref} does not match Work Unit ${workUnit.id}`,
      )
    }
  }

  return { valid: issues.length === 0, issues }
}

export function assertHarnessExecutionGrant(
  grant: ProviderExecutionGrant,
  workUnit?: WorkUnit,
): void {
  const result = validateHarnessExecutionGrant(grant, workUnit)
  if (!result.valid) {
    throw new Error(`Invalid AAOP Provider Execution Grant:\n- ${result.issues.join('\n- ')}`)
  }
}

/**
 * Render the AAOP grant as a deterministic first user message for a Harness
 * session. The message is deliberately model-visible so the reviewed Harness
 * Session log can reconstruct the exact execution authority the model saw.
 */
export function renderHarnessGrantMessage(grant: ProviderExecutionGrant): string {
  assertHarnessExecutionGrant(grant)

  const packet = {
    schema: AAOP_PROVIDER_EXECUTION_GRANT_SCHEMA_URI,
    grant,
  }

  return [
    '[MING_WORKBENCH_AAOP_EXECUTION_GRANT]',
    'This is a bounded AAOP execution grant, not product truth or proof of completion.',
    'Execute only the granted scope. Current authoritative repository/runtime evidence outranks stale grant details.',
    'If current evidence conflicts with this grant or a protected effect becomes necessary, stop that path and report the conflict instead of widening authority.',
    'Return concrete repository/test/runtime evidence. Your own session/tool/workflow completion is not final acceptance.',
    '',
    JSON.stringify(packet, null, 2),
    '[/MING_WORKBENCH_AAOP_EXECUTION_GRANT]',
  ].join('\n')
}
