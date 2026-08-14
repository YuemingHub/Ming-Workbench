import { resolve } from 'node:path'
import { runHarnessAcpGrant } from '../.tmp/transports/harness-acp.js'

const harnessCheckout = process.env.MING_HARNESS_CHECKOUT
if (!harnessCheckout) {
  throw new Error('MING_HARNESS_CHECKOUT is required for the upstream ACP smoke')
}

const workbenchRoot = resolve(process.cwd())
const expected = 'WORKBENCH_ACP_SMOKE_OK'
const grant = {
  schema_version: '1.0',
  grant_id: 'grant-upstream-acp-smoke',
  provider: 'deepseek-harness',
  route: 'understand-review',
  working_contract_revision: 1,
  goal: 'Read the Workbench repository without mutation and complete the transport smoke.',
  baseline: [
    'This is an isolated CI smoke against the exact reviewed DeepSeek Harness source checkout.',
    'No repository mutation is authorized.',
  ],
  execution_mode: 'single-agent',
  task_pod: null,
  tasks: [
    {
      id: 'T1',
      action: 'Inspect the current workspace without modifying it.',
      verification: ['Return the scripted provider response through the real Harness ACP session.'],
      failure_path: 'Stop if any write or permission widening would be required.',
    },
  ],
  authorization: {
    mutation_boundary: 'read-only',
    write_target: null,
    allowed_effects: ['repository read'],
    protected_effects: [
      'repository write',
      'deployment',
      'task credential use',
      'paid external service',
    ],
  },
  acceptance_evidence: [
    'A real ACP session returns the mock-provider success text through the reviewed Harness agent loop.',
  ],
  human_open_questions: [],
  references: ['Ming Workbench upstream ACP CI smoke'],
  issued_at: new Date().toISOString(),
}

const result = await runHarnessAcpGrant({
  grant,
  cwd: workbenchRoot,
  harnessCheckout: resolve(harnessCheckout),
  workbenchRoot,
  provider: 'deepseek-official',
  model: 'deepseek-v4-pro',
  sessionRoot: resolve(workbenchRoot, '.workbench', 'runtime', 'harness-smoke-sessions'),
  shutdownGraceMs: 15_000,
})

if (!result.sessionId) {
  throw new Error('ACP smoke returned no session id')
}
if (result.stopReason !== 'end_turn') {
  throw new Error(`ACP smoke expected stopReason=end_turn, received ${result.stopReason}`)
}
if (!result.assistantText.includes(expected)) {
  throw new Error(
    `ACP smoke did not receive expected provider text. Received: ${JSON.stringify(result.assistantText)}`,
  )
}

console.log(
  JSON.stringify({
    smoke: 'pass',
    sessionId: result.sessionId,
    stopReason: result.stopReason,
    expectedTextObserved: true,
  }),
)
