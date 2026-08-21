import test from 'node:test'
import assert from 'node:assert/strict'

import {
  beginIdea,
  chooseEntry,
  createLetterIdea,
  confirmIdea,
  appendHumanTurn,
  applySynthesis,
  applyAgreement,
} from '../.tmp/idea/index.js'
import {
  adaptConfirmedIdeaToIntakeOptions,
  renderIntakeRequestFromOutcome,
} from '../.tmp/intake/outcome-adapter.js'

function confirmedIdea({ recommendation = '一个能录入、整理、查找菜谱的简单网页', willGet = '一个能直接用的菜谱整理网页', solves = '把菜谱整理从想法变成看得见的工具' } = {}) {
  let idea = createLetterIdea('2026-08-17T00:00:00.000Z')
  idea = beginIdea(idea)
  idea = chooseEntry(idea, '我已经有一个想法', '2026-08-17T00:00:00.001Z')
  idea = appendHumanTurn(idea, '我想做一个给家人整理菜谱的小东西', '2026-08-17T00:00:00.002Z')
  idea = applySynthesis(idea, {
    desiredReality: '把给家人整理菜谱这件事做成',
    strengths: ['你已经说了想做什么'],
    path: ['定下核心', '列出最小版本', '做出来给你看'],
    recommendation,
  }, '整理成下面这样', '2026-08-17T00:00:00.003Z')
  idea = applyAgreement(idea, {
    willGet,
    solves,
    whereSee: '在桌面直接打开来用',
    notDoing: '不做大而全的功能',
  }, '就这样', '2026-08-17T00:00:00.004Z')
  return confirmIdea(idea, '2026-08-17T00:00:00.005Z')
}

test('renderIntakeRequestFromOutcome leads with the recommendation', () => {
  const request = renderIntakeRequestFromOutcome(confirmedIdea())
  assert.ok(request.startsWith('一个能录入、整理、查找菜谱的简单网页'))
  assert.ok(request.includes('一个能直接用的菜谱整理网页'), 'round agreement willGet is included')
  assert.ok(request.includes('把菜谱整理从想法变成看得见的工具'), 'round agreement solves is included')
})

test('adaptConfirmedIdeaToIntakeOptions carries the selected project and derives rawRequest', () => {
  const options = adaptConfirmedIdeaToIntakeOptions(confirmedIdea(), {
    projectRoot: '/projects/recipes',
    trustedProject: true,
  })
  assert.equal(options.projectRoot, '/projects/recipes')
  assert.equal(options.trustedProject, true)
  assert.equal(options.rawRequest, renderIntakeRequestFromOutcome(confirmedIdea()))
})

test('adaptConfirmedIdeaToIntakeOptions is stable across calls (pure)', () => {
  const idea = confirmedIdea()
  const a = adaptConfirmedIdeaToIntakeOptions(idea, { projectRoot: '/p', trustedProject: true })
  const b = adaptConfirmedIdeaToIntakeOptions(idea, { projectRoot: '/p', trustedProject: true })
  assert.deepEqual(a, b)
})

test('refuses an unconfirmed idea', () => {
  let idea = createLetterIdea('2026-08-17T00:00:00.000Z')
  idea = beginIdea(idea)
  idea = chooseEntry(idea, '我已经有一个想法', '2026-08-17T00:00:00.001Z')
  idea = appendHumanTurn(idea, '我想做一个东西', '2026-08-17T00:00:00.002Z')
  assert.throws(
    () => renderIntakeRequestFromOutcome(idea),
    /unconfirmed/,
  )
})

test('refuses a confirmed idea missing its synthesis', () => {
  const idea = confirmedIdea()
  delete idea.synthesis
  assert.throws(() => renderIntakeRequestFromOutcome(idea), /synthesis/)
})

test('refuses a confirmed idea missing its round agreement', () => {
  const idea = confirmedIdea()
  delete idea.agreement
  assert.throws(() => renderIntakeRequestFromOutcome(idea), /agreement/)
})
