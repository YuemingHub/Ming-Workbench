import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assessDevelopmentExecutionFrontier,
  prepareDevelopmentIntake,
} from '../.tmp/domain-packs/development-aaop.js'

const unit = {
  id: 'WU-002',
  spaceId: 'family-space-development',
  title: 'Safely enter AAOP',
  outcome: 'Start one bounded Family Space development slice without colliding with active work.',
  state: 'ready',
  owner: 'workbench',
  gate: { kind: 'none', open: false },
  acceptance: [
    {
      id: 'A-1',
      statement: 'The selected slice does not overlap active repository work.',
      satisfied: false,
      evidenceIds: [],
    },
  ],
  evidence: [],
  assets: [],
  createdAt: '2026-08-14',
  updatedAt: '2026-08-14',
}

const frontier = {
  repository: 'YuemingHub/Family-Space',
  baseRef: 'production',
  observedAt: '2026-08-14',
  activeWork: [
    {
      id: 'PR-268',
      title: 'feat(parent): add hold-to-talk voice input',
      kind: 'pull-request',
      changedFiles: [
        'react-vite/src/parent/pages/DialoguePage.tsx',
        'src/services/ai-engine-core.js',
      ],
    },
  ],
}

const authorizationBoundary =
  'Working branch + Draft PR only; no production write, deployment, credential use, paid service, or real-family-data access.'

test('unknown file scope does not block read-only AAOP Developer Intake', () => {
  const result = prepareDevelopmentIntake({
    unit,
    authorizationBoundary,
    repository: { frontier },
  })

  assert.equal(result.status, 'ready-for-aaop-intake')
  assert.equal(result.frontierContext.kind, 'scope-required')
  assert.equal(result.executionRequiresFreshFrontier, true)
  assert.equal(result.aaopRequest.workUnitId, 'WU-002')
})

test('known active-work conflict is intake context, not a reason to ask the human for files first', () => {
  const result = prepareDevelopmentIntake({
    unit,
    authorizationBoundary,
    repository: {
      frontier,
      intendedFiles: ['react-vite/src/parent/pages/DialoguePage.tsx'],
    },
  })

  assert.equal(result.status, 'ready-for-aaop-intake')
  assert.equal(result.frontierContext.kind, 'conflict')
  assert.deepEqual(result.frontierContext.conflicts[0].workItemId, 'PR-268')
  assert.match(result.reason, /continue read-only Developer Intake/)
})

test('even an intake-time safe frontier must be re-read before execution', () => {
  const rawRequest = 'Please take one safe next development slice in Family Space.'
  const result = prepareDevelopmentIntake({
    unit,
    rawRequest,
    authorizationBoundary,
    repository: {
      frontier,
      intendedFiles: ['docs/evals/workbench-pilot.md'],
    },
  })

  assert.equal(result.status, 'ready-for-aaop-intake')
  assert.equal(result.frontierContext.kind, 'safe')
  assert.equal(result.executionRequiresFreshFrontier, true)
  assert.equal(result.aaopRequest.rawRequest, rawRequest)
  assert.equal(result.aaopRequest.desiredOutcome, unit.outcome)
  assert.equal(result.aaopRequest.authorizationBoundary, authorizationBoundary)
  assert.deepEqual(result.aaopRequest.acceptanceExpectations, [
    'The selected slice does not overlap active repository work.',
  ])

  // These belong to AAOP's canonical Developer Intake Envelope, not Workbench.
  assert.equal('route' in result.aaopRequest, false)
  assert.equal('routeConfidence' in result.aaopRequest, false)
  assert.equal('questionNeeded' in result.aaopRequest, false)
})

test('non-repository intake does not invent a mutation-frontier requirement', () => {
  const result = prepareDevelopmentIntake({ unit, authorizationBoundary })

  assert.equal(result.status, 'ready-for-aaop-intake')
  assert.equal(result.frontierContext, undefined)
  assert.equal(result.executionRequiresFreshFrontier, false)
  assert.equal(result.aaopRequest.rawRequest, unit.outcome)
})

test('hard execution gate still rejects unknown mutation scope', () => {
  const decision = assessDevelopmentExecutionFrontier({
    frontier,
    intendedFiles: [],
  })

  assert.equal(decision.kind, 'scope-required')
  assert.equal(decision.safeToStart, false)
})

test('hard execution gate rejects overlap with current active work', () => {
  const decision = assessDevelopmentExecutionFrontier({
    frontier,
    intendedFiles: ['src/services/ai-engine-core.js'],
  })

  assert.equal(decision.kind, 'conflict')
  assert.equal(decision.safeToStart, false)
})

test('hard execution gate passes only a known non-overlapping file surface', () => {
  const decision = assessDevelopmentExecutionFrontier({
    frontier,
    intendedFiles: ['workbench.project.json'],
  })

  assert.equal(decision.kind, 'safe')
  assert.equal(decision.safeToStart, true)
})
