import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  assertAaopEnvelopeMatchesRequest,
  buildHarnessChildEnvForPermission,
  parseAaopIntakeEnvelope,
  reconcileAaopCoordinatorWorkUnit,
  renderAaopCoordinatorPrompt,
} from '../.tmp/index.js'

const rawRequest = '帮我看这个项目当前最重要的问题是什么，然后告诉我下一步。'

function envelope(overrides = {}) {
  return {
    schema_version: '1.0',
    generated_at: '2026-08-14T04:00:00.000Z',
    raw_request: rawRequest,
    situation: 'existing_repository',
    route: 'understand-review',
    route_confidence: 0.92,
    ambiguities: [],
    question_needed: null,
    project_evidence_summary: ['Current repository evidence was inspected read-only.'],
    next_action: 'Inspect the current bounded frontier and define acceptance evidence.',
    ...overrides,
  }
}

const workUnit = {
  id: 'WU-coordinator-001',
  spaceId: 'project-development',
  title: rawRequest,
  outcome: rawRequest,
  state: 'intake',
  owner: 'development-aaop',
  gate: { kind: 'none', open: false },
  acceptance: [],
  evidence: [],
  assets: [],
  nextFrontier: 'Ground the request through the project AAOP Developer Intake bridge.',
  createdAt: '2026-08-14T03:59:00.000Z',
  updatedAt: '2026-08-14T03:59:00.000Z',
}

const prepared = {
  status: 'ready-for-aaop-coordinator',
  workUnit,
  manifest: {
    schema_version: '1.0',
    project: { id: 'fixture', title: 'Fixture', domain_pack: 'development-aaop' },
    development: { aaop_bridge: {} },
  },
  aaopRequest: {
    rawRequest,
    desiredOutcome: rawRequest,
    currentWorkbenchState: 'intake',
    workUnitId: workUnit.id,
    acceptanceExpectations: [],
    authorizationBoundary: 'Read-only Developer Intake only.',
  },
  bridge: {
    ready: true,
    readyResult: { operation: 'ready', command: 'node', args: [], exitCode: 0, stdout: 'READY', stderr: '', success: true },
    statusResult: { operation: 'status', command: 'node', args: [], exitCode: 0, stdout: '{"branch":"main"}', stderr: '', success: true },
    promptResult: { operation: 'prompt', command: 'node', args: [], exitCode: 0, stdout: 'Take responsibility from current evidence.', stderr: '', success: true },
  },
  coordinatorMessage: 'PROJECT BRIDGE CONTEXT',
}

test('parses only the canonical AAOP Intake Envelope shape', () => {
  const parsed = parseAaopIntakeEnvelope(JSON.stringify(envelope()))
  assert.equal(parsed.route, 'understand-review')
  assert.equal(parsed.route_confidence, 0.92)

  const fenced = parseAaopIntakeEnvelope(`\`\`\`json\n${JSON.stringify(envelope())}\n\`\`\``)
  assert.equal(fenced.raw_request, rawRequest)

  assert.throws(
    () => parseAaopIntakeEnvelope(`analysis first\n${JSON.stringify(envelope())}`),
    /must return only one JSON object/,
  )
  assert.throws(
    () => parseAaopIntakeEnvelope(JSON.stringify(envelope({ extra: true }))),
    /unsupported fields: extra/,
  )
  assert.throws(
    () => parseAaopIntakeEnvelope(JSON.stringify(envelope({ route_confidence: 1.1 }))),
    /between 0 and 1/,
  )
})

test('coordinator prompt requires exact canonical JSON and no mutation authority', () => {
  const prompt = renderAaopCoordinatorPrompt(prepared)
  assert.match(prompt, /AAOP_CANONICAL_INTAKE_ENVELOPE_OUTPUT_CONTRACT/)
  assert.match(prompt, /Return ONLY one JSON object/)
  assert.match(prompt, new RegExp(JSON.stringify(rawRequest).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(prompt, /not permission to mutate the repository/)
  assert.match(prompt, /must not modify files, branches, refs, remotes/)
})

test('rejects a coordinator envelope that rewrites the human request', () => {
  assert.throws(
    () => assertAaopEnvelopeMatchesRequest(envelope({ raw_request: 'rewritten request' }), rawRequest),
    /raw_request mismatch/,
  )
})

test('no human-owned question moves intake Work Unit to ready without fabricating acceptance', () => {
  const result = reconcileAaopCoordinatorWorkUnit(
    workUnit,
    envelope(),
    'session-ready',
    new Date('2026-08-14T04:01:00.000Z'),
  )

  assert.equal(result.state, 'ready')
  assert.deepEqual(result.gate, { kind: 'none', open: false })
  assert.deepEqual(result.acceptance, [])
  assert.equal(result.nextFrontier, envelope().next_action)
  assert.equal(result.evidence.length, 1)
  assert.equal(result.evidence[0].kind, 'session')
  assert.equal(result.evidence[0].authoritative, false)
  assert.match(result.evidence[0].summary, /not product truth or completion evidence/)
})

test('genuine human-owned question opens only a human-decision gate', () => {
  const question = 'Do you want the old public API intentionally removed?'
  const result = reconcileAaopCoordinatorWorkUnit(
    workUnit,
    envelope({ question_needed: question }),
    'session-question',
    new Date('2026-08-14T04:02:00.000Z'),
  )

  assert.equal(result.state, 'needs-human')
  assert.equal(result.gate.kind, 'human-decision')
  assert.equal(result.gate.open, true)
  assert.equal(result.gate.summary, question)
  assert.equal(result.nextFrontier, question)
  assert.deepEqual(result.acceptance, [])
})

test('intake child environment is hard read-only and strips task secrets', () => {
  const env = buildHarnessChildEnvForPermission(
    {
      PATH: '/usr/bin',
      DEEPSEEK_API_KEY: 'provider-key',
      GITHUB_TOKEN: 'drop-me',
      DATABASE_URL: 'drop-me-too',
    },
    { harnessCheckout: '/harness', workbenchRoot: '/workbench' },
    'read-only',
    'intake.cordis.yml',
  )

  assert.equal(env.DSH_PERMISSION_MODE, 'read-only')
  assert.equal(env.MING_WORKBENCH_ACP_CONFIG, 'intake.cordis.yml')
  assert.equal(env.DEEPSEEK_API_KEY, 'provider-key')
  assert.equal(env.GITHUB_TOKEN, undefined)
  assert.equal(env.DATABASE_URL, undefined)
})

test('intake Harness composition cannot advertise mutation or multi-agent tools', () => {
  const config = readFileSync(
    new URL('../harness/acp/intake.cordis.yml', import.meta.url),
    'utf8',
  )
  const launcher = readFileSync(
    new URL('../harness/acp/launcher.mjs', import.meta.url),
    'utf8',
  )

  assert.match(config, /mode: read-only/)
  assert.match(config, /@deepseek-ai\/dsh-tool-fs-search/)
  assert.equal(config.includes("name: '@deepseek-ai/dsh-tool-fs'"), false)
  for (const forbidden of [
    '@deepseek-ai/dsh-tool-subagent',
    '@deepseek-ai/dsh-tool-workflow',
    '@deepseek-ai/dsh-tool-ralph',
    '@deepseek-ai/dsh-tool-goal',
  ]) {
    assert.equal(config.includes(forbidden), false, `unexpected intake capability: ${forbidden}`)
  }

  assert.match(launcher, /workbench\.cordis\.yml/)
  assert.match(launcher, /intake\.cordis\.yml/)
  assert.match(launcher, /unsupported Workbench ACP config/)
})
