import test from 'node:test'
import assert from 'node:assert/strict'

import {
  appendHumanTurn,
  beginIdea,
  chooseEntry,
  createLetterIdea,
  synthesizeAgreement,
  synthesizeTurn,
} from '../.tmp/idea/index.js'

function ideaWithTwoHumanTurns() {
  let idea = beginIdea(createLetterIdea('2026-08-21T09:00:00.000Z'))
  idea = chooseEntry(idea, '我已经有一个想法', '2026-08-21T09:00:00.001Z')
  idea = appendHumanTurn(idea, '我做饭时总要翻聊天记录找菜谱。', '2026-08-21T09:00:00.002Z')
  idea = appendHumanTurn(idea, '先把我最常做的几道放在一起就好。', '2026-08-21T09:00:00.003Z')
  return idea
}

function turnJson() {
  return JSON.stringify({
    reply: '我明白了，先整理最常做的几道。',
    ready: true,
    synthesis: {
      desiredReality: '做饭时能快速找到常做菜谱',
      strengths: ['你说了常做的几道'],
      path: ['先挑出常做的几道', '放在一个固定位置'],
      recommendation: '一份常做菜谱清单',
    },
  })
}

function agreementJson() {
  return JSON.stringify({
    willGet: '一份常做菜谱清单',
    solves: '不用再翻聊天记录找菜谱',
    whereSee: '做饭时打开清单查看',
    notDoing: '不整理所有菜谱',
  })
}

function sequenceProvider(contents, calls = []) {
  return {
    async complete(systemPrompt, userContent) {
      calls.push({ systemPrompt, userContent })
      return contents.shift()
    },
  }
}

test('malformed JSON -> one bounded recovery -> valid turn result', async () => {
  const calls = []
  const provider = sequenceProvider(['这不是 JSON', turnJson()], calls)
  const result = await synthesizeTurn(undefined, ideaWithTwoHumanTurns(), provider)

  assert.equal(result.ready, true)
  assert.equal(result.synthesis.recommendation, '一份常做菜谱清单')
  assert.equal(calls.length, 2)
  assert.match(calls[1].systemPrompt, /上一次响应无法按约定解析/)
})

test('malformed JSON -> recovery still malformed -> existing honest fallback', async () => {
  const calls = []
  const provider = sequenceProvider(['不是 JSON', '仍然不是 JSON'], calls)
  const result = await synthesizeTurn(undefined, ideaWithTwoHumanTurns(), provider)

  assert.equal(result.ready, false)
  assert.equal(result.reply, '我还在理解你说的这件事，我们再往前说一步就好。')
  assert.equal(calls.length, 2)
})

test('401/429 transport failures do not execute semantic recovery', async () => {
  for (const status of [401, 429]) {
    let calls = 0
    const provider = {
      async complete() {
        calls += 1
        throw new Error(`provider chat failed (${status})`)
      },
    }
    await assert.rejects(
      () => synthesizeTurn(undefined, ideaWithTwoHumanTurns(), provider),
      new RegExp(`provider chat failed \\(${status}\\)`),
    )
    assert.equal(calls, 1, `status ${status} must not be treated as malformed JSON`)
  }
})

test('valid JSON does not execute recovery', async () => {
  const calls = []
  const provider = sequenceProvider([turnJson(), 'unexpected second response'], calls)
  const result = await synthesizeTurn(undefined, ideaWithTwoHumanTurns(), provider)

  assert.equal(result.ready, true)
  assert.equal(calls.length, 1)
})

test('agreement recovery is also bounded once and keeps the four-field contract', async () => {
  const calls = []
  const provider = sequenceProvider(['prose instead of JSON', agreementJson()], calls)
  const idea = {
    ...ideaWithTwoHumanTurns(),
    synthesis: {
      desiredReality: '做饭时能快速找到常做菜谱',
      strengths: ['你说了常做的几道'],
      path: ['先挑出常做的几道'],
      recommendation: '一份常做菜谱清单',
    },
  }
  const result = await synthesizeAgreement(undefined, idea, provider)

  assert.equal(result.willGet, '一份常做菜谱清单')
  assert.equal(calls.length, 2)
})
