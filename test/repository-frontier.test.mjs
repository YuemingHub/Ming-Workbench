import test from 'node:test'
import assert from 'node:assert/strict'

import {
  assessRepositoryFrontier,
} from '../.tmp/domain-packs/repository-frontier.js'
import {
  assertCompletionInvariant,
  canMarkCompleted,
} from '../.tmp/core/model.js'

const familySpaceFrontier = {
  repository: 'YuemingHub/Family-Space',
  baseRef: 'production',
  observedAt: '2026-08-14',
  activeWork: [
    {
      id: 'PR-267',
      title: 'release: establish single S0 candidate from current production',
      kind: 'pull-request',
      changedFiles: [
        'package.json',
        'src/products/family/routes/api.js',
        'src/server.js',
        'src/services/ai-engine-core.js',
        'src/services/conversation-mode-router.js',
        'src/services/crisis-parent-response.js',
        'src/services/safety-gate.js',
      ],
    },
    {
      id: 'PR-268',
      title: 'feat(parent): add hold-to-talk voice input',
      kind: 'pull-request',
      changedFiles: [
        'package.json',
        'react-vite/src/parent/hooks/useVoiceRecorder.ts',
        'react-vite/src/parent/pages/DialoguePage.tsx',
        'src/products/family/routes/api.js',
        'src/services/ai-engine-core.js',
        'src/services/parent-language-pressure.js',
        'src/tests/test-voice-asr.js',
      ],
    },
  ],
}

test('refuses to claim a repository slice is safe before its file scope is known', () => {
  const decision = assessRepositoryFrontier(familySpaceFrontier, [])

  assert.equal(decision.kind, 'scope-required')
  assert.equal(decision.safeToStart, false)
})

test('detects collision with the active voice-input PR', () => {
  const decision = assessRepositoryFrontier(familySpaceFrontier, [
    'react-vite/src/parent/pages/DialoguePage.tsx',
  ])

  assert.equal(decision.kind, 'conflict')
  assert.equal(decision.safeToStart, false)
  assert.deepEqual(decision.conflicts.map((conflict) => conflict.workItemId), [
    'PR-268',
  ])
})

test('reports every active work item that owns the same shared file', () => {
  const decision = assessRepositoryFrontier(familySpaceFrontier, [
    'src/services/ai-engine-core.js',
  ])

  assert.equal(decision.kind, 'conflict')
  assert.deepEqual(
    decision.conflicts.map((conflict) => conflict.workItemId).sort(),
    ['PR-267', 'PR-268'],
  )
})

test('allows a proven non-overlapping slice to proceed', () => {
  const decision = assessRepositoryFrontier(familySpaceFrontier, [
    'docs/evals/workbench-pilot.md',
  ])

  assert.equal(decision.kind, 'safe')
  assert.equal(decision.safeToStart, true)
  assert.equal(decision.conflicts.length, 0)
})

test('a completed Work Unit still requires evidence-backed acceptance', () => {
  const unit = {
    id: 'WU-001',
    spaceId: 'family-space-development',
    title: 'Prove repository frontier intake',
    outcome: 'Avoid colliding with active Family Space implementation work.',
    state: 'completed',
    owner: 'workbench',
    gate: { kind: 'none', open: false },
    acceptance: [
      {
        id: 'A-1',
        statement: 'Active PR overlap is detected.',
        satisfied: true,
        evidenceIds: [],
      },
    ],
    evidence: [],
    assets: [],
    createdAt: '2026-08-14',
    updatedAt: '2026-08-14',
  }

  assert.equal(canMarkCompleted(unit), false)
  assert.throws(() => assertCompletionInvariant(unit), /evidence-backed acceptance/)

  unit.evidence.push({
    id: 'E-1',
    kind: 'repository',
    summary: 'Family Space PR #268 changed DialoguePage.tsx.',
    observedAt: '2026-08-14',
    authoritative: true,
  })
  unit.acceptance[0].evidenceIds.push('E-1')

  assert.equal(canMarkCompleted(unit), true)
  assert.doesNotThrow(() => assertCompletionInvariant(unit))
})
