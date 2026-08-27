import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertUserApprovedHandoffV0,
  validateUserApprovedHandoffV0,
} from '../.tmp/handoff/external-handoff.js'
import { createCreationWorkUnitFromHandoffV0 } from '../.tmp/handoff/to-work-unit.js'

function validPacket() {
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
    resources: ['cat-1.jpg'],
    userAuthorization: {
      approved: true,
      approvedAt: '2026-08-27T12:00:00Z',
    },
    returnRequested: true,
    createdAt: '2026-08-27T12:00:00Z',
  }
}

test('accepts the minimal explicitly approved packet', () => {
  const result = validateUserApprovedHandoffV0(validPacket())
  assert.equal(result.valid, true)
  assert.deepEqual(result.errors, [])
})

test('rejects an unapproved packet', () => {
  const packet = validPacket()
  packet.userAuthorization.approved = false
  const result = validateUserApprovedHandoffV0(packet)
  assert.equal(result.valid, false)
  assert.ok(result.errors.includes('userAuthorization.approved must be true'))
})

test('rejects extra private source context instead of silently ignoring it', () => {
  const packet = {
    ...validPacket(),
    privateConversationHistory: ['我讨厌我爸'],
  }
  const result = validateUserApprovedHandoffV0(packet)
  assert.equal(result.valid, false)
  assert.ok(result.errors.includes('unexpected field: privateConversationHistory'))
})

test('assertion returns a typed packet only after validation', () => {
  const packet = assertUserApprovedHandoffV0(validPacket())
  assert.equal(packet.confirmedIntent, '做一个记录小区流浪猫的网站')
  assert.throws(
    () => assertUserApprovedHandoffV0({ ...validPacket(), confirmedIntent: '' }),
    /Invalid external handoff/,
  )
})

test('approved handoff becomes a Creation Work Unit without AAOP ownership', () => {
  const result = createCreationWorkUnitFromHandoffV0(validPacket(), {
    now: () => new Date('2026-08-27T12:30:00Z'),
    idFactory: () => 'handoff-1',
  })

  assert.equal(result.route, 'creation')
  assert.equal(result.workUnit.id, 'WU-handoff-1')
  assert.equal(result.workUnit.owner, 'creation')
  assert.notEqual(result.workUnit.owner, 'development-aaop')
  assert.equal(result.workUnit.outcome, validPacket().firstOutcome)
  assert.equal(result.workUnit.acceptance.length, 1)
  assert.equal(result.workUnit.acceptance[0].satisfied, false)
  assert.deepEqual(result.workUnit.acceptance[0].evidenceIds, [])
  assert.equal(result.workUnit.assets.length, 1)
  assert.equal(result.workUnit.assets[0].uri, 'cat-1.jpg')
  assert.equal(result.workUnit.evidence[0].kind, 'human-confirmation')
})

test('unapproved handoff cannot create a Creation Work Unit', () => {
  const packet = validPacket()
  packet.userAuthorization.approved = false
  assert.throws(
    () => createCreationWorkUnitFromHandoffV0(packet),
    /Invalid external handoff/,
  )
})
