import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { runHarnessAcpGrant } from '../.tmp/transports/harness-acp.js'

const harnessCheckout = process.env.MING_HARNESS_CHECKOUT
if (!harnessCheckout) {
  throw new Error('MING_HARNESS_CHECKOUT is required for the write ACP smoke')
}

const workbenchRoot = resolve(process.cwd())
const workingRef = process.env.MING_WRITE_SMOKE_BRANCH
if (!workingRef) {
  throw new Error('MING_WRITE_SMOKE_BRANCH is required for the write ACP smoke')
}

const fixturePath = 'test/fixtures/harness-write-smoke.txt'
const absoluteFixture = resolve(workbenchRoot, fixturePath)
const expectedFile = 'WORKBENCH_HARNESS_WRITE_OK\n'
const expectedAssistant = 'WORKBENCH_HARNESS_WRITE_DONE'

if (existsSync(absoluteFixture)) {
  rmSync(absoluteFixture)
}

const grant = {
  schema_version: '1.0',
  grant_id: 'grant-upstream-acp-write-smoke',
  provider: 'deepseek-harness',
  route: 'feature-change',
  working_contract_revision: 1,
  goal: 'Create exactly one isolated smoke-test fixture through the real Harness write tool.',
  baseline: [
    'This is an ephemeral GitHub Actions worktree for YuemingHub/Ming-Workbench.',
    `Only ${fixturePath} may be created by this grant.`,
  ],
  execution_mode: 'single-agent',
  task_pod: null,
  tasks: [
    {
      id: 'T1',
      action: `Create ${fixturePath} with the exact smoke marker and do not modify any other file.`,
      expected_output: `${fixturePath} contains the expected marker.`,
      verification: [
        `Read back ${fixturePath}.`,
        'Verify Git status contains only the granted fixture mutation.',
      ],
      failure_path: 'Stop on any sandbox denial, unexpected mutation, or authority mismatch.',
    },
  ],
  authorization: {
    mutation_boundary: 'write-authorized',
    write_target: {
      repository: 'YuemingHub/Ming-Workbench',
      base_ref: 'main',
      working_ref: workingRef,
      environment: 'github-actions-ephemeral-worktree',
    },
    allowed_effects: [`create ${fixturePath} in the current working branch`],
    protected_effects: [
      'modify any other repository file',
      'push or publish repository changes',
      'deployment',
      'task credential use',
      'paid external service',
    ],
  },
  acceptance_evidence: [
    `${fixturePath} exists with exact expected content.`,
    `Git status contains only ?? ${fixturePath}.`,
    'A real ACP session returns the second scripted provider response after the write tool result.',
  ],
  human_open_questions: [],
  references: ['Ming Workbench write-authorized upstream ACP CI smoke'],
  issued_at: new Date().toISOString(),
}

const result = await runHarnessAcpGrant({
  grant,
  cwd: workbenchRoot,
  harnessCheckout: resolve(harnessCheckout),
  workbenchRoot,
  provider: 'deepseek-official',
  model: 'deepseek-v4-pro',
  sessionRoot: resolve(workbenchRoot, '.workbench', 'runtime', 'harness-write-smoke-sessions'),
  shutdownGraceMs: 15_000,
})

if (!result.sessionId) {
  throw new Error('write ACP smoke returned no session id')
}
if (result.stopReason !== 'end_turn') {
  throw new Error(`write ACP smoke expected stopReason=end_turn, received ${result.stopReason}`)
}
if (!result.assistantText.includes(expectedAssistant)) {
  throw new Error(
    `write ACP smoke did not receive expected completion text. Received: ${JSON.stringify(result.assistantText)}`,
  )
}
if (!existsSync(absoluteFixture)) {
  throw new Error(`Harness write tool did not create ${fixturePath}`)
}
const actualFile = readFileSync(absoluteFixture, 'utf8')
if (actualFile !== expectedFile) {
  throw new Error(
    `Harness write tool created unexpected content: ${JSON.stringify(actualFile)}`,
  )
}

const status = execFileSync('git', ['-C', workbenchRoot, 'status', '--porcelain', '--untracked-files=all'], {
  encoding: 'utf8',
}).trim().split(/\r?\n/).filter(Boolean)
const expectedStatus = `?? ${fixturePath}`
if (status.length !== 1 || status[0] !== expectedStatus) {
  throw new Error(
    `write ACP smoke mutated an unexpected repository surface: ${JSON.stringify(status)}`,
  )
}

console.log(
  JSON.stringify({
    smoke: 'write-pass',
    sessionId: result.sessionId,
    stopReason: result.stopReason,
    fixturePath,
    exactContentObserved: true,
    exactMutationSurfaceObserved: true,
  }),
)
