import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { canMarkCompleted } from '../.tmp/core/model.js'
import { createCreationWorkUnitFromHandoffV0 } from '../.tmp/handoff/to-work-unit.js'
import { executeCreationWorkUnit } from '../.tmp/creation/creation-execution.js'

function handoff() {
  return {
    schemaVersion: '0.1.0',
    kind: 'user-approved-handoff',
    sourceProduct: 'Return-to-oneself',
    targetProduct: 'Ming',
    reason: 'create-real-outcome',
    userWords: '对，我想做这个。',
    confirmedIntent: '做一个记录小区流浪猫的网站',
    firstOutcome: '先做一个可以打开的简单网页',
    preferences: [],
    resources: [],
    userAuthorization: { approved: true, approvedAt: '2026-08-27T12:00:00Z' },
    returnRequested: true,
    createdAt: '2026-08-27T12:00:00Z',
  }
}

test('closing the human gate outside the acceptance path still cannot satisfy completion', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mw-creation-invariant-'))
  try {
    const workspace = join(root, 'workspace')
    mkdirSync(workspace)
    const unit = createCreationWorkUnitFromHandoffV0(handoff(), {
      idFactory: () => 'invariant-1',
    }).workUnit
    const result = await executeCreationWorkUnit({
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

    assert.equal(result.workUnit.state, 'needs-human')
    assert.equal(canMarkCompleted(result.workUnit), false)

    const tampered = {
      ...result.workUnit,
      gate: { kind: 'none', open: false },
      state: 'completed',
    }
    assert.equal(canMarkCompleted(tampered), false)
    assert.equal(
      tampered.acceptance[0].evidenceIds.some((id) => id.endsWith('HUMAN-ACCEPTANCE')),
      true,
    )
    assert.equal(
      tampered.evidence.some((e) => e.id.endsWith('HUMAN-ACCEPTANCE')),
      false,
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
