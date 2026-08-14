/**
 * Provider Execution Grant issuance for Ming Workbench.
 *
 * AAOP owns the grant contract (schema, authorization boundaries, completion
 * truth). Workbench is the AAOP consumer: when a human explicitly authorizes a
 * bounded mutation, Workbench constructs the grant as an exact AAOP-schema
 * object, scoped to the proposed mutation and the current repository HEAD, and
 * stores it server-side. The grant is NEVER created by the browser.
 *
 * The human authorization decision is the source of authority; this module only
 * records it in the canonical AAOP shape and correlates it to the Work Unit.
 */

import { randomUUID } from 'node:crypto'
import type { WorkUnit } from '../core/model.js'
import type {
  ProviderExecutionGrant,
  WorkbenchExecutionBinding,
} from './provider-grant.js'
import type { RepositorySnapshot } from './repository.js'
import { resolve } from 'node:path'

export interface IssueGrantOptions {
  workUnit: WorkUnit
  projectRoot: string
  snapshot: RepositorySnapshot
  idFactory?: () => string
  now?: () => Date
  /** Explicit file surface the human authorized. Defaults to the whole repo. */
  intendedFiles?: string[]
}

export interface IssuedGrant {
  grant: ProviderExecutionGrant
  binding: WorkbenchExecutionBinding
  intendedFiles: string[]
}

export function issueProviderExecutionGrant(options: IssueGrantOptions): IssuedGrant {
  const now = options.now ?? (() => new Date())
  const grantId = options.idFactory?.() ?? `GRANT-${randomUUID()}`
  const projectRoot = resolve(options.projectRoot)
  const baseRef = options.snapshot.head || 'HEAD'
  const intendedFiles = options.intendedFiles ?? [projectRoot]

  const grant: ProviderExecutionGrant = {
    schema_version: '1.0',
    grant_id: grantId,
    provider: 'deepseek-harness',
    route: 'bug-fix',
    working_contract_revision: 1,
    goal: options.workUnit.outcome,
    baseline: options.snapshot.head ? [options.snapshot.head] : [],
    execution_mode: 'single-agent',
    task_pod: null,
    tasks: [
      {
        id: 'T1',
        action: `Apply the human-authorized mutation for: ${options.workUnit.outcome}`,
        failure_path: 'report-conflict',
        verification: ['repository changes stay within the granted scope', 'project tests pass'],
      },
    ],
    authorization: {
      mutation_boundary: 'write-authorized',
      write_target: {
        repository: projectRoot,
        base_ref: baseRef,
        working_ref: baseRef,
        environment: null,
      },
      allowed_effects: ['local-file-write'],
      protected_effects: [
        'deploy',
        'publish',
        'payment',
        'database-mutation',
        'cloud-resource',
        'production-api-post',
      ],
    },
    acceptance_evidence: ['repository delta within granted scope', 'project tests pass'],
    human_open_questions: [],
    references: [`work-unit:${options.workUnit.id}`],
    issued_at: now().toISOString(),
  }

  const binding: WorkbenchExecutionBinding = {
    workUnitId: options.workUnit.id,
    grantId,
  }

  return { grant, binding, intendedFiles }
}
