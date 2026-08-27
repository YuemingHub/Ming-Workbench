import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createCreationWorkUnitFromHandoffV0 } from '../.tmp/handoff/to-work-unit.js'
import { acceptCreationWorkUnit, executeCreationWorkUnit } from '../.tmp/creation/creation-execution.js'
import { buildCreationReturnPacketV0 } from '../.tmp/creation/return-packet.js'

function handoff(returnRequested = true) {
  return {
    schemaVersion: '0.1.0',
    kind: 'user-approved-handoff',
    sourceProduct: 'Return-to-oneself',
    targetProduct: 'Ming',
    reason: 'create-real-outcome',
    userWords: '对，我想做这个。',
    confirmedIntent: '做一个记录小区流浪猫的网站',
    firstOutcome: '先做一个可以打开的简单网页',
    preferences: ['简单', '温暖'],
    resources: [],
    userAuthorization: { approved: true, approvedAt: '2026-08-27T12:00:00Z' },
    returnRequested,
    createdAt: '2026-08-27T12:00:00Z',
  }
}

async function verifiedPending(root, packet = handoff()) {
  const workspace = join(root, 'workspace')
  mkdirSync(workspace)
  const unit = createCreationWorkUnitFromHandoffV0(packet, {
    idFactory: () => 'return-1',
  }).workUnit
  return executeCreationWorkUnit({
    workUnit: unit,
    workspaceRoot: workspace,
    provider: {
      id: 'fixture-provider',
      async execute(request) {
        writeFileSync(join(request.workspaceRoot, 'index.html'), '<h1>猫</h1>')
        return { runStatus: 'completed', summary: 'done', artifactPaths: ['index.html'] }
      },
    },
    idFactory: () => 'artifact-1',
  })
}

test('cannot return before explicit human acceptance', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mw-return-'))
  try {
    const packet = handoff()
    const pending = await verifiedPending(root, packet)
    assert.throws(
      () => buildCreationReturnPacketV0(packet, pending.workUnit),
      /not completed/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('completed Creation produces a minimal non-technical Return Packet', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mw-return-'))
  try {
    const packet = handoff()
    const pending = await verifiedPending(root, packet)
    const completed = acceptCreationWorkUnit(pending.workUnit, {
      now: () => new Date('2026-08-27T13:00:00Z'),
    })
    const returned = buildCreationReturnPacketV0(packet, completed, {
      humanFeedback: ['我看到以后还想加一个地图'],
      openQuestions: ['下一轮要不要加地图'],
      now: () => new Date('2026-08-27T13:05:00Z'),
    })

    assert.equal(returned.kind, 'return-packet')
    assert.equal(returned.originalIntent, packet.confirmedIntent)
    assert.equal(returned.actualOutcome, packet.firstOutcome)
    assert.deepEqual(returned.humanFeedback, ['我看到以后还想加一个地图'])
    assert.equal(returned.evidenceSummary.length, 2)
    const serialized = JSON.stringify(returned)
    assert.doesNotMatch(serialized, /fixture-provider|Harness|Agent|Provider|\.tmp|workspace/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('no Return Packet is created when the person did not request return', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mw-return-'))
  try {
    const packet = handoff(false)
    const pending = await verifiedPending(root, packet)
    const completed = acceptCreationWorkUnit(pending.workUnit)
    assert.throws(
      () => buildCreationReturnPacketV0(packet, completed),
      /did not request a return/,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
