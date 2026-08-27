import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { canMarkCompleted } from '../.tmp/core/model.js'
import { createCreationWorkUnitFromHandoffV0 } from '../.tmp/handoff/to-work-unit.js'
import {
  acceptCreationWorkUnit,
  executeCreationWorkUnit,
  rejectCreationWorkUnit,
} from '../.tmp/creation/creation-execution.js'

function handoff() {
  return {
    schemaVersion: '0.1.0',
    kind: 'user-approved-handoff',
    sourceProduct: 'Return-to-oneself',
    targetProduct: 'Ming',
    reason: 'create-real-outcome',
    userWords: '对，我想做这个。',
    confirmedIntent: '做一个记录小区流浪猫的网站',
    firstOutcome: '先做一个可打开的简单网页，展示照片、名字和发现地点',
    preferences: ['简单', '温暖'],
    resources: [],
    userAuthorization: {
      approved: true,
      approvedAt: '2026-08-27T12:00:00Z',
    },
    returnRequested: true,
    createdAt: '2026-08-27T12:00:00Z',
  }
}

function creationUnit() {
  return createCreationWorkUnitFromHandoffV0(handoff(), {
    now: () => new Date('2026-08-27T12:10:00Z'),
    idFactory: () => 'creation-1',
  }).workUnit
}

test('verified artifact is still partial until the human accepts it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mw-creation-'))
  try {
    const workspace = join(root, 'workspace')
    mkdirSync(workspace)
    const provider = {
      id: 'fixture-provider',
      async execute(request) {
        writeFileSync(join(request.workspaceRoot, 'index.html'), '<h1>流浪猫</h1>')
        return {
          runStatus: 'completed',
          summary: 'provider says done',
          artifactPaths: ['index.html'],
        }
      },
    }

    const result = await executeCreationWorkUnit({
      workUnit: creationUnit(),
      provider,
      workspaceRoot: workspace,
      now: () => new Date('2026-08-27T12:20:00Z'),
      idFactory: () => 'artifact-1',
    })

    assert.equal(result.status, 'awaiting-human')
    assert.equal(result.workUnit.state, 'needs-human')
    assert.equal(result.workUnit.gate.kind, 'human-decision')
    assert.equal(result.workUnit.gate.open, true)
    assert.equal(result.verifiedArtifactPaths.length, 1)
    assert.equal(result.workUnit.evidence.some((e) => e.verifier === 'independent-verification'), true)
    assert.equal(canMarkCompleted(result.workUnit), false)

    const accepted = acceptCreationWorkUnit(result.workUnit, {
      now: () => new Date('2026-08-27T12:30:00Z'),
      idFactory: () => 'human-1',
    })
    assert.equal(accepted.state, 'completed')
    assert.equal(accepted.gate.open, false)
    assert.equal(accepted.evidence.some((e) => e.verifier === 'human-confirmation'), true)
    assert.equal(canMarkCompleted(accepted), true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('human rejection reopens the Creation Work Unit for revision instead of completing it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mw-creation-'))
  try {
    const workspace = join(root, 'workspace')
    mkdirSync(workspace)
    const provider = {
      id: 'fixture-provider',
      async execute(request) {
        writeFileSync(join(request.workspaceRoot, 'index.html'), '<h1>第一版</h1>')
        return { runStatus: 'completed', summary: 'done', artifactPaths: ['index.html'] }
      },
    }
    const result = await executeCreationWorkUnit({
      workUnit: creationUnit(),
      provider,
      workspaceRoot: workspace,
    })
    const rejected = rejectCreationWorkUnit(result.workUnit, '我想加一个地图')
    assert.equal(rejected.state, 'ready')
    assert.equal(rejected.gate.open, false)
    assert.match(rejected.nextFrontier, /地图/)
    assert.equal(canMarkCompleted(rejected), true)
    assert.notEqual(rejected.state, 'completed')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('provider completion without an artifact is blocked', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mw-creation-'))
  try {
    const workspace = join(root, 'workspace')
    mkdirSync(workspace)
    const provider = {
      id: 'empty-provider',
      async execute() {
        return { runStatus: 'completed', summary: 'done', artifactPaths: [] }
      },
    }
    const result = await executeCreationWorkUnit({
      workUnit: creationUnit(),
      provider,
      workspaceRoot: workspace,
    })
    assert.equal(result.status, 'blocked')
    assert.equal(result.workUnit.state, 'blocked')
    assert.equal(result.verifiedArtifactPaths.length, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('provider cannot claim an artifact outside the Creation workspace', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mw-creation-'))
  try {
    const workspace = join(root, 'workspace')
    mkdirSync(workspace)
    const outside = join(root, 'outside.html')
    writeFileSync(outside, '<h1>outside</h1>')
    const provider = {
      id: 'escaping-provider',
      async execute() {
        return { runStatus: 'completed', summary: 'done', artifactPaths: [outside] }
      },
    }
    const result = await executeCreationWorkUnit({
      workUnit: creationUnit(),
      provider,
      workspaceRoot: workspace,
    })
    assert.equal(result.status, 'blocked')
    assert.equal(result.workUnit.state, 'blocked')
    assert.match(result.summary, /escapes Creation workspace/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
