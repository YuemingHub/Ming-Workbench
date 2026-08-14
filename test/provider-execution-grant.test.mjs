import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assertHarnessExecutionGrant,
  renderHarnessGrantMessage,
  validateHarnessExecutionGrant,
} from '../.tmp/execution/provider-grant.js'

function grant(overrides = {}) {
  return {
    schema_version: '1.0',
    grant_id: 'grant-family-space-001',
    work_unit_ref: 'WU-003',
    provider: 'deepseek-harness',
    route: 'feature-change',
    working_contract_revision: 4,
    goal: 'Make one non-overlapping Family Space documentation change and verify it.',
    baseline: [
      'Family Space base ref is production.',
      'Active PR #267 and #268 own overlapping runtime files; this grant does not touch them.',
    ],
    execution_mode: 'single-agent',
    task_pod: null,
    tasks: [
      {
        id: 'T1',
        owner: 'harness-root-agent',
        action: 'Create the bounded documentation change on the authorized working branch.',
        verification: ['Read back the diff on the exact working ref.'],
        failure_path: 'Stop and report any new repository-frontier conflict.',
      },
    ],
    authorization: {
      mutation_boundary: 'write-authorized',
      write_target: {
        repository: 'YuemingHub/Family-Space',
        base_ref: 'production',
        working_ref: 'workbench/pilot-003',
        environment: null,
      },
      allowed_effects: ['working-branch repository write', 'Draft PR creation'],
      protected_effects: [
        'production write',
        'deployment',
        'credential use',
        'paid external service',
        'real-family-data access',
      ],
    },
    acceptance_evidence: [
      'Exact working-ref diff contains only the admitted file surface.',
      'Repository-native validation relevant to the change passes.',
    ],
    human_open_questions: [],
    references: ['Ming Workbench Work Unit WU-003', 'AAOP Working Contract revision 4'],
    issued_at: '2026-08-14T10:30:00+08:00',
    ...overrides,
  }
}

const workUnit = {
  id: 'WU-003',
  spaceId: 'family-space-development',
  title: 'Execute first Harness grant',
  outcome: 'Make one safe bounded repository change through Harness.',
  state: 'running',
  owner: 'development-aaop',
  gate: { kind: 'none', open: false },
  acceptance: [
    {
      id: 'A-1',
      statement: 'The exact authorized diff is verified.',
      satisfied: false,
      evidenceIds: [],
    },
  ],
  evidence: [],
  assets: [],
  createdAt: '2026-08-14',
  updatedAt: '2026-08-14',
}

test('accepts a bounded single-agent DeepSeek Harness grant', () => {
  const result = validateHarnessExecutionGrant(grant(), workUnit)
  assert.equal(result.valid, true)
  assert.deepEqual(result.issues, [])
})

test('rejects unresolved human-owned questions before execution', () => {
  const result = validateHarnessExecutionGrant(
    grant({ human_open_questions: ['Which production environment should receive this?'] }),
  )

  assert.equal(result.valid, false)
  assert.match(result.issues.join('\n'), /unresolved human-owned questions/)
})

test('rejects task-pod execution on the single-agent P0 Harness preset', () => {
  const result = validateHarnessExecutionGrant(
    grant({
      execution_mode: 'task-pod',
      task_pod: {
        pod_id: 'pod-1',
        accountable_owner: 'root',
        members: ['root', 'reviewer'],
      },
    }),
  )

  assert.equal(result.valid, false)
  assert.match(result.issues.join('\n'), /single-agent/)
})

test('rejects a write-authorized grant without an exact write target', () => {
  const candidate = grant()
  candidate.authorization = {
    ...candidate.authorization,
    write_target: null,
  }

  const result = validateHarnessExecutionGrant(candidate)
  assert.equal(result.valid, false)
  assert.match(result.issues.join('\n'), /exact write_target/)
})

test('rejects a grant that points at another Work Unit', () => {
  const result = validateHarnessExecutionGrant(
    grant({ work_unit_ref: 'WU-other' }),
    workUnit,
  )

  assert.equal(result.valid, false)
  assert.match(result.issues.join('\n'), /does not match Work Unit WU-003/)
})

test('allows read-only execution only when write_target is null', () => {
  const readOnly = grant({
    authorization: {
      mutation_boundary: 'read-only',
      write_target: null,
      allowed_effects: ['repository read', 'test execution without mutation'],
      protected_effects: ['repository write', 'deployment'],
    },
  })

  assert.doesNotThrow(() => assertHarnessExecutionGrant(readOnly))
})

test('renders the grant as a durable, explicit first Harness user message', () => {
  const message = renderHarnessGrantMessage(grant())

  assert.match(message, /^\[MING_WORKBENCH_AAOP_EXECUTION_GRANT\]/)
  assert.match(message, /grant-family-space-001/)
  assert.match(message, /workbench\/pilot-003/)
  assert.match(message, /production write/)
  assert.match(message, /repository\/runtime evidence outranks stale grant details/)
  assert.match(message, /session\/tool\/workflow completion is not final acceptance/)
  assert.match(message, /\[\/MING_WORKBENCH_AAOP_EXECUTION_GRANT\]$/)
})
