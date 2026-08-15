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
import {
  assertSliceAllowsWrite,
  sliceScopeLabel,
  type MutationSlice,
} from './mutation-slice.js'
import { resolve } from 'node:path'

export interface IssueGrantOptions {
  workUnit: WorkUnit
  projectRoot: string
  snapshot: RepositorySnapshot
  /**
   * The exact mutation boundary the human authorized. P0-1: an unknown surface
   * must refuse write authorization instead of defaulting to a disguised
   * whole-repository scope; a whole-repository scope must be modeled
   * explicitly, never as `[projectRoot]` pretending to be one file.
   */
  slice: MutationSlice
  idFactory?: () => string
  now?: () => Date
}

export interface IssuedGrant {
  grant: ProviderExecutionGrant
  binding: WorkbenchExecutionBinding
  slice: MutationSlice
}

export function issueProviderExecutionGrant(options: IssueGrantOptions): IssuedGrant {
  // Fail-closed: write authorization requires a known file surface.
  assertSliceAllowsWrite(options.slice)

  const now = options.now ?? (() => new Date())
  const grantId = options.idFactory?.() ?? `GRANT-${randomUUID()}`
  const projectRoot = resolve(options.projectRoot)
  const baseRef = options.snapshot.head || 'HEAD'

  if (resolve(options.slice.repository) !== projectRoot) {
    throw new Error(
      `mutation slice repository ${options.slice.repository} does not match the authorized project ${projectRoot}.`,
    )
  }
  if (options.slice.baseRef && options.slice.baseRef !== baseRef) {
    throw new Error(
      `mutation slice baseRef ${options.slice.baseRef} does not match the granted base_ref ${baseRef}; re-read the repository before authorizing.`,
    )
  }

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
        // The exact branch the human authorized (HEAD SHA when detached).
        // Matching a branch name keeps the workspace assertion unambiguous for
        // local projects and CI worktrees alike.
        working_ref: options.snapshot.branch || baseRef,
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
    acceptance_evidence: [
      `repository delta within granted scope (${sliceScopeLabel(options.slice)})`,
      'project tests pass',
    ],
    human_open_questions: [],
    references: [`work-unit:${options.workUnit.id}`],
    issued_at: now().toISOString(),
  }

  const binding: WorkbenchExecutionBinding = {
    workUnitId: options.workUnit.id,
    grantId,
  }

  return { grant, binding, slice: options.slice }
}
