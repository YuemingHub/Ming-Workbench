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
  let idea = beginIdea(createLetterIdea())
  idea = chooseEntry(idea, '我已经有一个想法')
  idea = appendHumanTurn(idea, '我做饭时总要翻聊天记录找菜谱。')
  idea = appendHumanTurn(idea, '先把我最常做的几道放在一起就好。')
  return idea
}

function response(content) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

test('turn synthesis retries once when the provider violates the JSON contract', async () => {
  const originalFetch = globalThis.fetch
  const contents = [
    '我理解了，你是想把常做菜谱放在一起。',
    JSON.stringify({
      reply: '我明白了，先整理最常做的几道。',
      ready: true,
      synthesis: {
        desiredReality: '做饭时能快速找到常做菜谱',
        strengths: ['你说了常做的几道'],
        path: ['先挑出常做的几道', '放在一个固定位置'],
        recommendation: '一份常做菜谱清单',
      },
    }),
  ]
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return response(contents.shift())
  }
  try {
    const result = await synthesizeTurn(
      { baseUrl: 'http://provider.test/v1', apiKey: 'test-key', model: 'test-model' },
      ideaWithTwoHumanTurns(),
    )
    assert.equal(result.ready, true)
    assert.equal(result.synthesis?.recommendation, '一份常做菜谱清单')
    assert.equal(calls, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('agreement synthesis retries once without changing the agreement contract', async () => {
  const originalFetch = globalThis.fetch
  const contents = [
    '这一轮先这样做。',
    JSON.stringify({
      willGet: '一份常做菜谱清单',
      solves: '不用再翻聊天记录找菜谱',
      whereSee: '做饭时打开清单查看',
      notDoing: '不整理所有菜谱',
    }),
  ]
  let calls = 0
  globalThis.fetch = async () => {
    calls += 1
    return response(contents.shift())
  }
  try {
    const idea = { ...ideaWithTwoHumanTurns(), synthesis: {
      desiredReality: '做饭时能快速找到常做菜谱',
      strengths: ['你说了常做的几道'],
      path: ['先挑出常做的几道'],
      recommendation: '一份常做菜谱清单',
    } }
    const result = await synthesizeAgreement(
      { baseUrl: 'http://provider.test/v1', apiKey: 'test-key', model: 'test-model' },
      idea,
    )
    assert.equal(result.willGet, '一份常做菜谱清单')
    assert.equal(calls, 2)
  } finally {
    globalThis.fetch = originalFetch
  }
})

