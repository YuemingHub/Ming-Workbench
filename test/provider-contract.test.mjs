/**
 * Provider contract tests.
 * Tests buildHarnessChildEnv for correct provider/model/env inheritance.
 * No real credentials used.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, rmSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const TMP_DIR = join(tmpdir(), 'mw-provider-contract-test')

const { buildHarnessChildEnv } = await import('../.tmp/transports/harness-acp.js')

function makeReadonlyGrant() {
  return {
    schema_version: '1.0',
    grant_id: 'test-grant-001',
    provider: 'deepseek-harness',
    route: 'understand-review',
    working_contract_revision: 1,
    goal: 'Test provider env inheritance',
    baseline: ['HEAD'],
    execution_mode: 'single-agent',
    task_pod: null,
    tasks: [{
      id: 'task-1',
      action: 'analyze',
      expected_output: 'env inherited',
      verification: ['env check'],
      failure_path: 'fail',
    }],
    authorization: {
      mutation_boundary: 'read-only',
      write_target: null,
      allowed_effects: ['read'],
      protected_effects: [],
    },
    acceptance_evidence: ['env-inherited'],
    human_open_questions: [],
    references: [],
    issued_at: new Date().toISOString(),
  }
}

function makeWriteGrant() {
  return {
    ...makeReadonlyGrant(),
    grant_id: 'test-grant-002',
    authorization: {
      mutation_boundary: 'write-authorized',
      write_target: {
        repository: 'test-repo',
        base_ref: 'main',
        working_ref: 'feature/test',
      },
      allowed_effects: ['write'],
      protected_effects: ['production-data'],
    },
  }
}

test('buildHarnessChildEnv: provider environment inheritance (read-only)', () => {
  setup()

  const result = buildHarnessChildEnv(
    {
      PATH: process.env.PATH,
      DEEPSEEK_API_KEY: 'test-key',
      DEEPSEEK_BASE_URL: 'https://test.api.com',
    },
    {
      harnessCheckout: join(REPO_ROOT, '.harness-checkout'),
      workbenchRoot: REPO_ROOT,
      provider: 'deepseek-official',
      model: 'test-model',
    },
    makeReadonlyGrant()
  )

  teardown()

  assert.ok(result, 'Should return env object')
  assert.equal(result.DEEPSEEK_API_KEY, 'test-key', 'Should inherit DEEPSEEK_API_KEY')
  assert.equal(result.DEEPSEEK_BASE_URL, 'https://test.api.com', 'Should inherit DEEPSEEK_BASE_URL')
  assert.equal(result.DSH_PERMISSION_MODE, 'read-only', 'Should set read-only permission mode')
})

test('buildHarnessChildEnv: write-authorized grant sets workspace-write', () => {
  setup()

  const result = buildHarnessChildEnv(
    {
      PATH: process.env.PATH,
      DEEPSEEK_API_KEY: 'test-key',
      DEEPSEEK_BASE_URL: 'https://test.api.com',
    },
    {
      harnessCheckout: join(REPO_ROOT, '.harness-checkout'),
      workbenchRoot: REPO_ROOT,
      provider: 'deepseek-official',
      model: 'test-model',
    },
    makeWriteGrant()
  )

  teardown()

  assert.equal(result.DSH_PERMISSION_MODE, 'workspace-write', 'Should set workspace-write permission mode')
})

test('buildHarnessChildEnv: does not leak task-specific credentials', () => {
  setup()

  const result = buildHarnessChildEnv(
    {
      PATH: process.env.PATH,
      DEEPSEEK_API_KEY: 'test-key',
      GITHUB_TOKEN: 'should-not-leak',
      AWS_SECRET: 'should-not-leak',
    },
    {
      harnessCheckout: join(REPO_ROOT, '.harness-checkout'),
      workbenchRoot: REPO_ROOT,
      provider: 'deepseek-official',
      model: 'test-model',
    },
    makeReadonlyGrant()
  )

  teardown()

  assert.equal(result.GITHUB_TOKEN, undefined, 'GITHUB_TOKEN should not leak')
  assert.equal(result.AWS_SECRET, undefined, 'AWS_SECRET should not leak')
})

test('buildHarnessChildEnv: custom provider configuration', () => {
  const result = buildHarnessChildEnv(
    {
      PATH: process.env.PATH,
      DEEPSEEK_API_KEY: 'custom-key',
      DEEPSEEK_BASE_URL: 'https://custom.api.com/v1',
    },
    {
      harnessCheckout: join(REPO_ROOT, '.harness-checkout'),
      workbenchRoot: REPO_ROOT,
      provider: 'deepseek-official',
      model: 'custom-model',
    },
    makeReadonlyGrant()
  )

  assert.ok(result, 'Should return env object')
  assert.equal(result.DEEPSEEK_API_KEY, 'custom-key', 'Should inherit DEEPSEEK_API_KEY')
  assert.equal(result.DEEPSEEK_BASE_URL, 'https://custom.api.com/v1', 'Should inherit DEEPSEEK_BASE_URL')
  assert.equal(result.MING_HARNESS_MODEL, 'custom-model', 'Should set model in env')
})

function setup() {
  mkdirSync(TMP_DIR, { recursive: true })
}

function teardown() {
  rmSync(TMP_DIR, { recursive: true, force: true })
}
