import test from 'node:test'
import assert from 'node:assert/strict'

import {
  runDevelopmentIntakeApplication,
  toWorkUnitDisplayView,
} from '../.tmp/index.js'

const manifest = {
  schema_version: '1.0',
  project: {
    id: 'fixture-project',
    title: 'Fixture Project',
    domain_pack: 'development-aaop',
  },
  development: {
    aaop_bridge: {
      ready: { command: 'node', args: ['ready'] },
      status: { command: 'node', args: ['status'] },
      prompt: { command: 'node', args: ['prompt'] },
    },
  },
}

function workUnit(overrides = {}) {
  return {
    id: 'WU-desktop-intake-001',
    spaceId: 'SPACE-fixture-project',
    title: '看看这个项目下一步该做什么',
    outcome: '看看这个项目下一步该做什么',
    state: 'intake',
    owner: 'development-aaop',
    gate: { kind: 'none', open: false },
    acceptance: [],
    evidence: [],
    assets: [],
    nextFrontier: 'Ground the request through read-only Developer Intake.',
    createdAt: '2026-08-14T05:30:00.000Z',
    updatedAt: '2026-08-14T05:30:00.000Z',
    ...overrides,
  }
}

function readyPrepared(overrides = {}) {
  return {
    status: 'ready-for-aaop-coordinator',
    workUnit: workUnit(),
    manifest,
    aaopRequest: {
      rawRequest: '看看这个项目下一步该做什么',
      desiredOutcome: '看看这个项目下一步该做什么',
      currentWorkbenchState: 'intake',
      workUnitId: 'WU-desktop-intake-001',
      acceptanceExpectations: [],
      authorizationBoundary: 'Read-only Developer Intake only.',
    },
    bridge: {
      ready: true,
      readyResult: { operation: 'ready', command: 'node', args: [], exitCode: 0, stdout: 'READY', stderr: '', success: true },
      statusResult: { operation: 'status', command: 'node', args: [], exitCode: 0, stdout: '{}', stderr: '', success: true },
      promptResult: { operation: 'prompt', command: 'node', args: [], exitCode: 0, stdout: 'Continue from current evidence.', stderr: '', success: true },
    },
    coordinatorMessage: 'PROJECT BRIDGE CONTEXT',
    ...overrides,
  }
}

function envelope(overrides = {}) {
  return {
    schema_version: '1.0',
    generated_at: '2026-08-14T05:31:00.000Z',
    raw_request: '看看这个项目下一步该做什么',
    situation: 'existing_repository',
    route: 'understand-review',
    route_confidence: 0.91,
    ambiguities: [],
    question_needed: null,
    project_evidence_summary: ['Repository inspected read-only.'],
    next_action: 'Review the current project frontier.',
    ...overrides,
  }
}

const baseOptions = {
  rawRequest: '看看这个项目下一步该做什么',
  projectRoot: '/workspace/fixture',
  trustedProject: true,
  harnessCheckout: '/harness',
  workbenchRoot: '/workbench',
  now: () => new Date('2026-08-14T05:30:00.000Z'),
  idFactory: () => 'desktop-intake-001',
}

test('desktop intake application derives Space identity before entering project Intake', async () => {
  let preparedOptions
  let coordinatorOptions
  const prepared = readyPrepared()
  const coordinatedUnit = workUnit({
    state: 'ready',
    evidence: [
      {
        id: 'EV-AAOP-INTAKE-secret-session-id',
        kind: 'session',
        summary: 'Read-only AAOP Developer Intake derived a route.',
        uri: 'deepseek-harness-acp:secret-session-id',
        observedAt: '2026-08-14T05:31:00.000Z',
        authoritative: false,
      },
    ],
    nextFrontier: 'Review the current project frontier.',
  })

  const result = await runDevelopmentIntakeApplication(baseOptions, {
    loadManifest: () => manifest,
    prepareProjectIntake: (options) => {
      preparedOptions = options
      return prepared
    },
    runCoordinator: async (options) => {
      coordinatorOptions = options
      return {
        workUnit: coordinatedUnit,
        envelope: envelope(),
        sessionId: 'secret-session-id',
        stopReason: 'end_turn',
        assistantText: JSON.stringify(envelope()),
      }
    },
  })

  assert.equal(preparedOptions.spaceId, 'SPACE-fixture-project')
  assert.equal(preparedOptions.manifest, manifest)
  assert.equal(coordinatorOptions.prepared, prepared)
  assert.equal(result.status, 'ready')
  assert.deepEqual(result.space, {
    id: 'SPACE-fixture-project',
    title: 'Fixture Project',
    projectId: 'fixture-project',
    projectRoot: '/workspace/fixture',
    domainPackId: 'development-aaop',
  })
  assert.equal(result.workUnit.state, 'ready')
  assert.equal(result.intake.route, 'understand-review')
  assert.equal(result.intake.routeConfidence, 0.91)

  assert.equal('sessionId' in result, false)
  assert.equal('assistantText' in result, false)
  assert.equal('id' in result.workUnit.evidence[0], false)
  assert.equal('uri' in result.workUnit.evidence[0], false)
  assert.match(result.workUnit.evidence[0].summary, /Read-only AAOP Developer Intake/)
})

test('desktop intake application surfaces a genuine human decision as needs-human', async () => {
  const question = 'Should this intentionally remove the public compatibility endpoint?'
  const result = await runDevelopmentIntakeApplication(baseOptions, {
    loadManifest: () => manifest,
    prepareProjectIntake: () => readyPrepared(),
    runCoordinator: async () => ({
      workUnit: workUnit({
        state: 'needs-human',
        gate: { kind: 'human-decision', open: true, summary: question, owner: 'human' },
        nextFrontier: question,
      }),
      envelope: envelope({ question_needed: question, next_action: question }),
      sessionId: 'session-question',
      stopReason: 'end_turn',
      assistantText: JSON.stringify(envelope({ question_needed: question })),
    }),
  })

  assert.equal(result.status, 'needs-human')
  assert.equal(result.workUnit.gate.kind, 'human-decision')
  assert.equal(result.workUnit.gate.open, true)
  assert.equal(result.intake.questionNeeded, question)
})

test('blocked project AAOP bridge stays blocked and never starts the coordinator', async () => {
  let coordinatorCalled = false
  const blocked = {
    status: 'project-aaop-blocked',
    workUnit: workUnit({
      state: 'blocked',
      nextFrontier: 'Repair the project AAOP bridge.',
    }),
    manifest,
    aaopRequest: {
      rawRequest: baseOptions.rawRequest,
      desiredOutcome: baseOptions.rawRequest,
      currentWorkbenchState: 'intake',
      workUnitId: 'WU-desktop-intake-001',
      acceptanceExpectations: [],
      authorizationBoundary: 'Read-only Developer Intake only.',
    },
    bridge: {
      ready: false,
      readyResult: { operation: 'ready', command: 'node', args: [], exitCode: 1, stdout: '', stderr: 'AAOP not ready', success: false },
    },
    reason: 'Project AAOP bridge ready command did not succeed. AAOP not ready',
  }

  const result = await runDevelopmentIntakeApplication(baseOptions, {
    loadManifest: () => manifest,
    prepareProjectIntake: () => blocked,
    runCoordinator: async () => {
      coordinatorCalled = true
      throw new Error('must not run')
    },
  })

  assert.equal(result.status, 'blocked')
  assert.equal(result.blocker, blocked.reason)
  assert.equal(result.workUnit.state, 'blocked')
  assert.equal(coordinatorCalled, false)
})

test('normal Work Unit display projection does not expose provider-specific evidence identity', () => {
  const view = toWorkUnitDisplayView(workUnit({
    evidence: [
      {
        id: 'EV-internal',
        kind: 'session',
        summary: 'Useful human-facing evidence summary.',
        uri: 'deepseek-harness-acp:internal-session',
        observedAt: '2026-08-14T05:31:00.000Z',
        authoritative: false,
      },
    ],
  }))

  assert.deepEqual(view.evidence, [
    {
      kind: 'session',
      summary: 'Useful human-facing evidence summary.',
      observedAt: '2026-08-14T05:31:00.000Z',
      authoritative: false,
    },
  ])
})
