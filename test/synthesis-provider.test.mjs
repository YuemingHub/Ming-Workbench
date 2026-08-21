import test from 'node:test'
import assert from 'node:assert/strict'

import {
  beginIdea,
  chooseEntry,
  createLetterIdea,
  appendHumanTurn,
  applySynthesis,
  synthesizeTurn,
  synthesizeAgreement,
} from '../.tmp/idea/index.js'

// A deterministic provider returns canned, valid JSON keyed by the prompt
// marker. It stands in for "a correct LLM" and never touches the network.
function deterministicProvider() {
  const synthesis = {
    desiredReality: '一个随手记下零碎家事、随时翻看的小工具',
    strengths: ['你说清了痛点：家里零碎事老忘', '你说清了边界：随手记、随时看'],
    path: ['定最小结果：记一条加看列表', '做成一个打开就能用的单页', '先给你用起来'],
    recommendation: '一个能随手记一条家事、随时翻看列表、关掉再开记录还在的小工具',
  }
  const agreement = {
    willGet: '一个能记、能看、关掉再开记录还在的家庭记录小工具',
    solves: '把家里零碎事从“老忘”变成“随手记、随时翻”',
    whereSee: '双击打开就能用',
    notDoing: '不做账号、不做多设备同步',
  }
  return {
    async complete(systemPrompt, _userContent) {
      if (systemPrompt.includes('MING_HUMAN_FIRST_AGREEMENT')) {
        return JSON.stringify(agreement)
      }
      return JSON.stringify({ reply: '我理解了，建议先做最小结果。', ready: true, synthesis })
    },
  }
}

// A mock provider models a real provider's readiness transition: not ready
// until the human has spoken more than once, then ready with a synthesis.
function transitioningProvider() {
  return {
    async complete(systemPrompt, userContent) {
      const humanTurns = (userContent.match(/这个人说/g) ?? []).length
      if (systemPrompt.includes('MING_HUMAN_FIRST_AGREEMENT')) {
        return JSON.stringify({
          willGet: '一个能记能看的家庭记录小工具',
          solves: '把零碎事从老忘变成随手记',
          whereSee: '双击打开',
          notDoing: '不做账号',
        })
      }
      if (humanTurns < 2) {
        return JSON.stringify({ reply: '再多说一点你想记的都行。', ready: false })
      }
      return JSON.stringify({
        reply: '信息够了，我整理一下。',
        ready: true,
        synthesis: {
          desiredReality: '一个随手记家事的小工具',
          strengths: ['你说清了想记家里零碎事'],
          path: ['记一条加看列表', '做成单页'],
          recommendation: '一个能随手记一条家事、随时翻看的小工具',
        },
      })
    },
  }
}

function failingProvider() {
  return {
    async complete() {
      throw new Error('provider unavailable: simulated outage')
    },
  }
}

function ideaWith(humanTurns) {
  let idea = createLetterIdea('2026-08-21T09:00:00.000Z')
  idea = beginIdea(idea)
  idea = chooseEntry(idea, '我只有一点模糊念头', '2026-08-21T09:00:00.001Z')
  for (const turn of humanTurns) {
    idea = appendHumanTurn(idea, turn, '2026-08-21T09:00:00.002Z')
  }
  return idea
}

test('deterministic provider: synthesizeTurn returns ready with a grounded synthesis', async () => {
  const idea = ideaWith(['家里零碎事老忘，想弄个小东西记下来'])
  const result = await synthesizeTurn(undefined, idea, deterministicProvider())
  assert.equal(result.ready, true)
  assert.equal(result.synthesis.recommendation, '一个能随手记一条家事、随时翻看列表、关掉再开记录还在的小工具')
  assert.ok(result.synthesis.strengths.length >= 1)
})

test('deterministic provider: synthesizeAgreement returns the four required semantics', async () => {
  let idea = ideaWith(['家里零碎事老忘'])
  const turn = await synthesizeTurn(undefined, idea, deterministicProvider())
  idea = applySynthesis(idea, turn.synthesis, turn.reply, '2026-08-21T09:00:00.003Z')
  const agreement = await synthesizeAgreement(undefined, idea, deterministicProvider())
  assert.ok(agreement.willGet && agreement.solves && agreement.whereSee && agreement.notDoing)
})

test('mock provider: readiness transitions from not-ready to ready as the human says more', async () => {
  let idea = ideaWith(['家里事老忘'])
  const first = await synthesizeTurn(undefined, idea, transitioningProvider())
  assert.equal(first.ready, false)
  assert.ok(first.reply.length > 0)

  idea = appendHumanTurn(idea, '不用太复杂，随手记就行', '2026-08-21T09:00:00.004Z')
  const second = await synthesizeTurn(undefined, idea, transitioningProvider())
  assert.equal(second.ready, true)
  assert.ok(second.synthesis.recommendation.length > 0)
})

test('a ready=false reply with an empty synthesis payload keeps the model reply (not the generic fallback)', async () => {
  // Some providers emit the full JSON shape (schema-shaped but blank synthesis)
  // alongside ready=false. The strict synthesis schema rejects blank fields;
  // the clarifying question must survive, not be replaced by the fallback.
  const emptySynthesisProvider = {
    async complete() {
      return JSON.stringify({
        reply: '我先确认一下：现在家里是怎么记这些事的？',
        ready: false,
        synthesis: { desiredReality: '', strengths: [], path: [], recommendation: '' },
      })
    },
  }
  const idea = ideaWith(['家里零碎事老忘'])
  const result = await synthesizeTurn(undefined, idea, emptySynthesisProvider)
  assert.equal(result.ready, false)
  assert.equal(result.reply, '我先确认一下：现在家里是怎么记这些事的？')
})

test('failure provider: a provider error propagates (the seam does not swallow it into a no-provider reply)', async () => {
  const idea = ideaWith(['家里事老忘'])
  await assert.rejects(
    () => synthesizeTurn(undefined, idea, failingProvider()),
    /provider unavailable/,
  )
})

test('no provider and no endpoint degrades to the no-provider reply (HTTP default preserved)', async () => {
  const idea = ideaWith(['家里事老忘'])
  const result = await synthesizeTurn(undefined, idea)
  assert.equal(result.ready, false)
  assert.ok(result.reply.includes('连上一个 AI 助手'))
})
