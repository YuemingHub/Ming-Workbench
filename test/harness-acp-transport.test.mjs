import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  assertGrantWorkspace,
  assertHarnessAcpAdmission,
  assertReviewedHarnessCheckout,
  buildHarnessChildEnv,
  inspectHarnessCheckout,
} from '../.tmp/transports/harness-acp.js'

function run(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function createWorkspace({ repository = 'YuemingHub/Family-Space', branch = 'workbench/pilot-acp' } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), 'ming-workbench-git-'))
  run(cwd, ['init'])
  run(cwd, ['config', 'user.email', 'workbench@example.invalid'])
  run(cwd, ['config', 'user.name', 'Ming Workbench Test'])
  writeFileSync(join(cwd, 'README.md'), 'fixture\n')
  run(cwd, ['add', 'README.md'])
  run(cwd, ['commit', '-m', 'fixture'])
  run(cwd, ['branch', 'production'])
  run(cwd, ['checkout', '-b', branch])
  run(cwd, ['remote', 'add', 'origin', `git@github.com:${repository}.git`])
  return cwd
}

function grant(overrides = {}) {
  return {
    schema_version: '1.0',
    grant_id: 'grant-acp-001',
    provider: 'deepseek-harness',
    route: 'feature-change',
    working_contract_revision: 1,
    goal: 'Execute one bounded ACP transport pilot.',
    baseline: [],
    execution_mode: 'single-agent',
    task_pod: null,
    tasks: [
      {
        id: 'T1',
        action: 'Make the admitted change.',
        verification: ['Read back the exact diff.'],
        failure_path: 'Stop on conflict or denied authority.',
      },
    ],
    authorization: {
      mutation_boundary: 'write-authorized',
      write_target: {
        repository: 'YuemingHub/Family-Space',
        base_ref: 'production',
        working_ref: 'workbench/pilot-acp',
        environment: null,
      },
      allowed_effects: ['working-branch repository write'],
      protected_effects: ['production write', 'deployment', 'task credential use'],
    },
    acceptance_evidence: ['Exact branch diff is verified.'],
    human_open_questions: [],
    references: ['Ming Workbench Work Unit WU-ACP-001'],
    issued_at: '2026-08-14T10:45:00+08:00',
    ...overrides,
  }
}

const workUnit = {
  id: 'WU-ACP-001',
  spaceId: 'family-space-development',
  title: 'Execute ACP transport pilot',
  outcome: 'Execute one bounded ACP transport pilot.',
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

test('ACP admission validates canonical grant and Workbench binding separately', () => {
  const candidate = grant()
  assert.doesNotThrow(() =>
    assertHarnessAcpAdmission({
      grant: candidate,
      binding: { workUnitId: workUnit.id, grantId: candidate.grant_id },
      workUnit,
    }),
  )

  assert.throws(
    () => assertHarnessAcpAdmission({ grant: candidate, workUnit }),
    /requires both binding and Work Unit/,
  )
  assert.throws(
    () => assertHarnessAcpAdmission({
      grant: candidate,
      binding: { workUnitId: 'WU-other', grantId: candidate.grant_id },
      workUnit,
    }),
    /does not match Work Unit/,
  )
})

test('write-authorized grant must match workspace origin, branch, and resolvable base', () => {
  const cwd = createWorkspace()
  try {
    assert.doesNotThrow(() => assertGrantWorkspace(grant(), cwd))

    const wrongRepo = grant()
    wrongRepo.authorization = {
      ...wrongRepo.authorization,
      write_target: {
        ...wrongRepo.authorization.write_target,
        repository: 'YuemingHub/Ming-Workbench',
      },
    }
    assert.throws(() => assertGrantWorkspace(wrongRepo, cwd), /does not match workspace origin/)

    const wrongBranch = grant()
    wrongBranch.authorization = {
      ...wrongBranch.authorization,
      write_target: {
        ...wrongBranch.authorization.write_target,
        working_ref: 'workbench/another-branch',
      },
    }
    assert.throws(() => assertGrantWorkspace(wrongBranch, cwd), /does not match current branch/)

    const wrongBase = grant()
    wrongBase.authorization = {
      ...wrongBase.authorization,
      write_target: {
        ...wrongBase.authorization.write_target,
        base_ref: 'missing-base',
      },
    }
    assert.throws(() => assertGrantWorkspace(wrongBase, cwd), /does not resolve/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('read-only grant still requires a git worktree but never invents a write target', () => {
  const cwd = createWorkspace()
  try {
    const readOnly = grant({
      authorization: {
        mutation_boundary: 'read-only',
        write_target: null,
        allowed_effects: ['repository read'],
        protected_effects: ['repository write'],
      },
    })
    assert.doesNotThrow(() => assertGrantWorkspace(readOnly, cwd))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('local-path write grant (desktop issuance) passes without any origin remote', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ming-workbench-local-grant-'))
  try {
    run(cwd, ['init'])
    run(cwd, ['config', 'user.email', 'workbench@example.invalid'])
    run(cwd, ['config', 'user.name', 'Ming Workbench Test'])
    writeFileSync(join(cwd, 'README.md'), 'fixture\n')
    run(cwd, ['add', 'README.md'])
    run(cwd, ['commit', '-m', 'fixture'])
    const head = run(cwd, ['rev-parse', 'HEAD'])
    const branch = run(cwd, ['branch', '--show-current'])

    const localGrant = grant({
      authorization: {
        mutation_boundary: 'write-authorized',
        write_target: {
          repository: cwd,
          base_ref: head,
          working_ref: branch,
          environment: null,
        },
        allowed_effects: ['local-file-write'],
        protected_effects: ['deploy', 'publish'],
      },
    })
    assert.doesNotThrow(() => assertGrantWorkspace(localGrant, cwd))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('local-path write grant rejects a different workspace path', () => {
  const cwd = createWorkspace()
  try {
    const head = run(cwd, ['rev-parse', 'HEAD'])
    const branch = run(cwd, ['branch', '--show-current'])
    const other = grant()
    other.authorization = {
      ...other.authorization,
      write_target: {
        ...other.authorization.write_target,
        repository: join(tmpdir(), 'some-other-project'),
        base_ref: head,
        working_ref: branch,
      },
    }
    assert.throws(() => assertGrantWorkspace(other, cwd), /does not match workspace origin/)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('local-path write grant accepts a detached-HEAD working_ref pinned to the SHA', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ming-workbench-detached-grant-'))
  try {
    run(cwd, ['init'])
    run(cwd, ['config', 'user.email', 'workbench@example.invalid'])
    run(cwd, ['config', 'user.name', 'Ming Workbench Test'])
    writeFileSync(join(cwd, 'README.md'), 'fixture\n')
    run(cwd, ['add', 'README.md'])
    run(cwd, ['commit', '-m', 'fixture'])
    const head = run(cwd, ['rev-parse', 'HEAD'])
    run(cwd, ['checkout', '--detach'])

    const detachedGrant = grant({
      authorization: {
        mutation_boundary: 'write-authorized',
        write_target: {
          repository: cwd,
          base_ref: head,
          working_ref: head,
          environment: null,
        },
        allowed_effects: ['local-file-write'],
        protected_effects: ['deploy', 'publish'],
      },
    })
    assert.doesNotThrow(() => assertGrantWorkspace(detachedGrant, cwd))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('slug grant with a GitHub origin still matches by slug, and a local path grant with a GitHub origin also passes', () => {
  const cwd = createWorkspace()
  try {
    assert.doesNotThrow(() => assertGrantWorkspace(grant(), cwd))

    // Desktop issuance records the local project path even when the clone has a
    // GitHub origin; the workspace assertion must accept the path identity too.
    const head = run(cwd, ['rev-parse', 'HEAD'])
    const branch = run(cwd, ['branch', '--show-current'])
    const pathGrant = grant()
    pathGrant.authorization = {
      ...pathGrant.authorization,
      write_target: {
        ...pathGrant.authorization.write_target,
        repository: cwd,
        base_ref: head,
        working_ref: branch,
      },
    }
    assert.doesNotThrow(() => assertGrantWorkspace(pathGrant, cwd))
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('ACP child environment forwards provider infrastructure but drops task secrets', () => {
  const env = buildHarnessChildEnv(
    {
      PATH: '/usr/bin',
      HOME: '/home/example',
      DEEPSEEK_API_KEY: 'provider-key',
      DEEPSEEK_BASE_URL: 'https://example.invalid',
      GITHUB_TOKEN: 'must-not-forward',
      ALIYUN_ACCESS_KEY_ID: 'must-not-forward',
      DATABASE_URL: 'must-not-forward',
    },
    {
      harnessCheckout: '/runtime/harness',
      workbenchRoot: '/runtime/workbench',
      provider: 'deepseek-official',
      model: 'deepseek-v4-pro',
      sessionRoot: '/runtime/sessions',
    },
    grant(),
  )

  assert.equal(env.DEEPSEEK_API_KEY, 'provider-key')
  assert.equal(env.DEEPSEEK_BASE_URL, 'https://example.invalid')
  assert.equal(env.GITHUB_TOKEN, undefined)
  assert.equal(env.ALIYUN_ACCESS_KEY_ID, undefined)
  assert.equal(env.DATABASE_URL, undefined)
  assert.equal(env.DSH_PERMISSION_MODE, 'workspace-write')
})

test('read-only grants map to a read-only Harness standing permission', () => {
  const readOnly = grant({
    authorization: {
      mutation_boundary: 'read-only',
      write_target: null,
      allowed_effects: ['repository read'],
      protected_effects: ['repository write'],
    },
  })
  const env = buildHarnessChildEnv(
    {},
    { harnessCheckout: '/harness', workbenchRoot: '/workbench' },
    readOnly,
  )
  assert.equal(env.DSH_PERMISSION_MODE, 'read-only')
})

test('unreviewed Harness source checkout fails before ACP execution', () => {
  const checkout = mkdtempSync(join(tmpdir(), 'ming-workbench-harness-'))
  try {
    mkdirSync(join(checkout, 'apps', 'cli'), { recursive: true })
    writeFileSync(
      join(checkout, 'apps', 'cli', 'package.json'),
      JSON.stringify({ version: '0.1.0-rc.5' }),
    )
    run(checkout, ['init'])
    run(checkout, ['config', 'user.email', 'workbench@example.invalid'])
    run(checkout, ['config', 'user.name', 'Ming Workbench Test'])
    run(checkout, ['add', '.'])
    run(checkout, ['commit', '-m', 'fake harness'])

    assert.throws(
      () => assertReviewedHarnessCheckout(checkout),
      /Unreviewed DeepSeek Harness checkout/,
    )
  } finally {
    rmSync(checkout, { recursive: true, force: true })
  }
})

test('ACP composition remains single-agent and cross-platform', () => {
  const config = readFileSync(
    new URL('../harness/acp/workbench.cordis.yml', import.meta.url),
    'utf8',
  )

  assert.match(config, /@deepseek-ai\/dsh-acp-demo/)
  assert.match(config, /maxParallelToolCalls: 1/)
  assert.match(config, /goals: false/)
  assert.match(config, /@deepseek-ai\/dsh-bash-sandbox/)
  assert.match(config, /@deepseek-ai\/dsh-pwsh-sandbox/)
  assert.match(config, /@deepseek-ai\/dsh-tool-pwsh/)
  assert.match(config, /@deepseek-ai\/dsh-fs-sandbox/)
  assert.match(config, /@deepseek-ai\/dsh-tool-fs-search/)
  assert.match(config, /DSH_PERMISSION_MODE/)
  assert.match(config, /policy: ask/)

  for (const forbidden of [
    '@deepseek-ai/dsh-tool-subagent',
    '@deepseek-ai/dsh-tool-workflow',
    '@deepseek-ai/dsh-tool-ralph',
    '@deepseek-ai/dsh-tool-goal',
  ]) {
    assert.equal(config.includes(forbidden), false, `unexpected ACP capability: ${forbidden}`)
  }
})

test('ACP launcher anchors bare plugins to Harness and does not load project .env', () => {
  const launcher = readFileSync(
    new URL('../harness/acp/launcher.mjs', import.meta.url),
    'utf8',
  )

  assert.match(launcher, /MING_HARNESS_CHECKOUT/)
  assert.match(launcher, /appBootUrl/)
  assert.match(launcher, /boot\(NAME, configPath, undefined, undefined, appBootUrl\)/)
  assert.equal(launcher.includes('loadEnv('), false)
  assert.match(launcher, /ACP owns stdout/)
})

test('checkout identity reads from the bundled capsule manifest without git', () => {
  const capsuleDir = mkdtempSync(join(tmpdir(), 'ming-workbench-capsule-'))
  try {
    mkdirSync(join(capsuleDir, 'apps', 'cli'), { recursive: true })
    writeFileSync(
      join(capsuleDir, 'apps', 'cli', 'package.json'),
      JSON.stringify({ version: '0.1.0-rc.5' }),
    )
    writeFileSync(
      join(capsuleDir, 'harness-runtime-manifest.json'),
      `${JSON.stringify({
        schemaVersion: 1,
        harness: {
          commit: '47f943859bef60e4160492346772ded9b24f765a',
          version: '0.1.0-rc.5',
        },
        keyFiles: {},
      }, null, 2)}\n`,
      'utf8',
    )

    // No .git anywhere in the capsule, so git-based identity would fail by
    // walking up to an unrelated parent repository. Manifest must win.
    const identity = inspectHarnessCheckout(capsuleDir)
    assert.equal(identity.commit, '47f943859bef60e4160492346772ded9b24f765a')
    assert.equal(identity.sourceVersion, '0.1.0-rc.5')

    // assertReviewedHarnessCheckout must accept the manifest-backed identity.
    assert.doesNotThrow(() => assertReviewedHarnessCheckout(capsuleDir))
  } finally {
    rmSync(capsuleDir, { recursive: true, force: true })
  }
})

test('checkout identity falls back to git for a non-capsule checkout', () => {
  const workspace = createWorkspace()
  try {
    mkdirSync(join(workspace, 'apps', 'cli'), { recursive: true })
    writeFileSync(
      join(workspace, 'apps', 'cli', 'package.json'),
      JSON.stringify({ version: '0.1.0-rc.5' }),
    )
    const identity = inspectHarnessCheckout(workspace)
    assert.equal(identity.sourceVersion, '0.1.0-rc.5')
    assert.match(identity.commit, /^[0-9a-f]{40}$/)
  } finally {
    rmSync(workspace, { recursive: true, force: true })
  }
})
