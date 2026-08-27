import assert from 'node:assert/strict'
import test from 'node:test'

import {
  assertUserApprovedHandoffV0,
  validateUserApprovedHandoffV0,
} from '../dist-test/handoff/external-handoff.js'

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
