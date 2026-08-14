import test from 'node:test'
import assert from 'node:assert/strict'

import { admitDevelopmentWorkUnit } from '../.tmp/domain-packs/development-aaop.js'

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

test('defers AAOP request when the intended file surface is unknown', () => {
  const result = admitDevelopmentWorkUnit({
    unit,
    authorizationBoundary,
    repository: { frontier, intendedFiles: [] },
  })

  assert.equal(result.status, 'deferred')
  assert.equal(result.frontierDecision.kind, 'scope-required')
})

test('defers AAOP request when the slice conflicts with active work', () => {
  const result = admitDevelopmentWorkUnit({
    unit,
    authorizationBoundary,
    repository: {
      frontier,
      intendedFiles: ['react-vite/src/parent/pages/DialoguePage.tsx'],
    },
  })

  assert.equal(result.status, 'deferred')
  assert.equal(result.frontierDecision.kind, 'conflict')
  assert.deepEqual(result.frontierDecision.conflicts[0].workItemId, 'PR-268')
})

test('creates one Workbench-to-AAOP request only after repository admission passes', () => {
  const rawRequest = 'Please take one safe next development slice in Family Space.'
  const result = admitDevelopmentWorkUnit({
    unit,
    rawRequest,
    authorizationBoundary,
    repository: {
      frontier,
      intendedFiles: ['docs/evals/workbench-pilot.md'],
    },
  })

  assert.equal(result.status, 'admitted')
  assert.equal(result.frontierDecision.kind, 'safe')
  assert.equal(result.aaopRequest.workUnitId, 'WU-002')
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

test('does not invent a repository gate for a request without an existing-repository target', () => {
  const result = admitDevelopmentWorkUnit({ unit, authorizationBoundary })

  assert.equal(result.status, 'admitted')
  assert.equal(result.frontierDecision, undefined)
  assert.equal(result.aaopRequest.rawRequest, unit.outcome)
})
