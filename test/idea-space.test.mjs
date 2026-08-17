import test from 'node:test'
import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { createServer } from 'node:http'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  beginIdea,
  chooseEntry,
  createLetterIdea,
  confirmIdea,
  appendHumanTurn,
  applySynthesis,
  applyAgreement,
  humanTurnCount,
  HUMAN_FIRST_ENTRIES,
} from '../.tmp/idea/index.js'
import { loadIdea, saveIdea, IDEA_STORE_FILE_NAME } from '../.tmp/idea/index.js'
import { startHumanFirstServer } from '../.tmp/idea/index.js'
import { synthesizeTurn } from '../.tmp/idea/index.js'

test('human-first entries are exactly the three required choices', () => {
  assert.deepEqual([...HUMAN_FIRST_ENTRIES], [
    '我已经有一个想法',
    '我只有一点模糊念头',
    '我现在也不知道想做什么',
  ])
})

test('idea space walks letter -> entry -> conversation -> review -> agreement -> confirmed', () => {
  let idea = createLetterIdea('2026-08-17T00:00:00.000Z')
  assert.equal(idea.stage, 'letter')

  idea = beginIdea(idea)
  assert.equal(idea.stage, 'entry')

  idea = chooseEntry(idea, '我已经有一个想法', '2026-08-17T00:00:00.001Z')
  assert.equal(idea.stage, 'conversation')
  assert.equal(humanTurnCount(idea), 0)

  idea = appendHumanTurn(idea, '我想做一个给家人整理菜谱的小东西', '2026-08-17T00:00:00.002Z')
  assert.equal(humanTurnCount(idea), 1)

  const synthesis = {
    desiredReality: '把给家人整理菜谱这件事做成',
    strengths: ['你已经说了想做什么：给家人整理菜谱'],
    path: ['定下核心', '列出最小版本', '做出来给你看'],
    recommendation: '一个能录入、整理、查找菜谱的简单网页',
  }
  idea = applySynthesis(idea, synthesis, '整理成下面这样', '2026-08-17T00:00:00.003Z')
  assert.equal(idea.stage, 'review')
  assert.deepEqual(idea.synthesis, synthesis)

  const agreement = {
    willGet: '一个能直接用的菜谱整理网页',
    solves: '把菜谱整理从想法变成看得见的工具',
    whereSee: '在桌面直接打开来用',
    notDoing: '不做大而全的功能',
  }
  idea = applyAgreement(idea, agreement, '这一轮这样开始', '2026-08-17T00:00:00.004Z')
  assert.equal(idea.stage, 'agreement')

  idea = confirmIdea(idea, '2026-08-17T00:00:00.005Z')
  assert.equal(idea.stage, 'confirmed')
  assert.ok(idea.confirmedAt)
})

test('invalid entry and premature confirmation are rejected', () => {
  let idea = beginIdea(createLetterIdea())
  assert.throws(() => chooseEntry(idea, '不存在的入口'))
  assert.throws(() => confirmIdea(idea))
})

test('idea persistence roundtrips and tolerates schema mismatch', () => {
  const storeDir = mkdtempSync(join(tmpdir(), 'idea-store-'))
  const idea = beginIdea(createLetterIdea())
  saveIdea(storeDir, idea)
  assert.equal(loadIdea(storeDir).stage, 'entry')

  const file = join(storeDir, IDEA_STORE_FILE_NAME)
  writeFileSync(file, '{"storeVersion":999,"idea":{}}', 'utf8')
  assert.equal(loadIdea(storeDir).stage, 'letter')

  writeFileSync(file, 'not json', 'utf8')
  assert.equal(loadIdea(storeDir).stage, 'letter')
})

test('synthesis degrades gracefully without a provider', async () => {
  let idea = createLetterIdea()
  idea = beginIdea(idea)
  idea = chooseEntry(idea, '我已经有一个想法')
  idea = appendHumanTurn(idea, '我想做一件事')
  const result = await synthesizeTurn(undefined, idea)
  assert.equal(result.ready, false)
  assert.ok(result.reply.length > 0)
})

test('human-first server drives the full loop and persists across restart', async () => {
  // Deterministic OpenAI-compatible mock (same contract as the repo fixture).
  const provider = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => {
      const messages = JSON.parse(body).messages || []
      const promptText = messages.map((m) => String(m.content ?? '')).join(' ')
      const isAgreement = promptText.includes('MING_HUMAN_FIRST_AGREEMENT')
      const humanLines = [...promptText.matchAll(/这个人说：([^\n]+)/g)].map((m) => m[1].trim())
      const first = humanLines[0] ?? '你想做成的那件事'
      let content
      if (isAgreement) {
        content = JSON.stringify({
          willGet: `这一轮你会得到一个能直接用的「${first}」最小版本`,
          solves: `把「${first}」从想法变成看得见的东西`,
          whereSee: '做完之后在桌面直接打开来用',
          notDoing: '这一轮不会做大而全的东西',
        })
      } else if (humanLines.length < 2) {
        content = JSON.stringify({ reply: '我记下了。再说多一点？', ready: false })
      } else {
        content = JSON.stringify({
          reply: '整理成下面这样。',
          ready: true,
          synthesis: {
            desiredReality: `把「${first}」这件事做成`,
            strengths: [`你已经说了你想要什么：${first}`],
            path: ['定下核心', '列出最小版本', '做出来给你看'],
            recommendation: `先做出一个能实现「${first}」的最小版本`,
          },
        })
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content } }] }))
    })
  })
  await new Promise((r) => provider.listen(0, '127.0.0.1', r))
  const providerPort = provider.address().port

  const storeDir = mkdtempSync(join(tmpdir(), 'idea-server-'))

  async function startServer() {
    return startHumanFirstServer({
      workbenchRoot: '/tmp',
      storeDir,
      provider: {
        baseUrl: `http://127.0.0.1:${providerPort}/v1`,
        apiKey: 'fixture-key',
        model: 'fixture-model',
      },
    })
  }

  async function jsonRequest(port, path, method, token, body) {
    return new Promise((resolvePromise, rejectPromise) => {
      const req = httpRequest(
        { host: '127.0.0.1', port, path, method, headers: {
          host: `127.0.0.1:${port}`,
          'content-type': 'application/json',
          ...(token ? { 'x-workbench-token': token } : {}),
          ...(method === 'POST' ? { origin: `http://127.0.0.1:${port}` } : {}),
        } },
        (res) => {
          let data = ''
          res.on('data', (c) => { data += c })
          res.on('end', () => {
            try { resolvePromise({ status: res.statusCode, body: JSON.parse(data) }) }
            catch { resolvePromise({ status: res.statusCode, body: data }) }
          })
        },
      )
      req.on('error', rejectPromise)
      if (body !== undefined) req.write(JSON.stringify(body))
      req.end()
    })
  }

  let handle = await startServer()
  let port = handle.port
  const token = handle.requestToken

  // 1. letter appears
  const page = await new Promise((resolvePromise, rejectPromise) => {
    httpRequest({ host: '127.0.0.1', port, path: '/', headers: { host: `127.0.0.1:${port}` } }, (res) => {
      let data = ''
      res.on('data', (c) => { data += c })
      res.on('end', () => resolvePromise(data))
    }).on('error', rejectPromise).end()
  })
  assert.ok(page.includes('MING WORKBENCH'))
  assert.ok(page.includes('id="start-button"'))
  assert.ok(!page.includes('选择项目'))

  // 2. start -> entry
  let r = await jsonRequest(port, '/api/idea/start', 'POST', token)
  assert.equal(r.body.idea.stage, 'entry')

  // 3. entry -> conversation
  r = await jsonRequest(port, '/api/idea/entry', 'POST', token, { entry: '我已经有一个想法' })
  assert.equal(r.body.idea.stage, 'conversation')
  assert.ok(r.body.idea.turns.length >= 1)

  // 4. first message -> still clarifying
  r = await jsonRequest(port, '/api/idea/message', 'POST', token, { text: '我想做一个给家人整理菜谱的工具' })
  assert.equal(r.body.idea.stage, 'conversation')

  // 5. second message -> ready synthesis
  r = await jsonRequest(port, '/api/idea/message', 'POST', token, { text: '最重要的是家里老人能一眼看懂怎么用' })
  assert.equal(r.body.idea.stage, 'review')
  assert.ok(r.body.idea.synthesis.recommendation.includes('菜谱'))

  // 6. agreement
  r = await jsonRequest(port, '/api/idea/agreement', 'POST', token)
  assert.equal(r.body.idea.stage, 'agreement')
  assert.ok(r.body.idea.agreement.willGet)
  assert.ok(r.body.idea.agreement.solves)
  assert.ok(r.body.idea.agreement.whereSee)
  assert.ok(r.body.idea.agreement.notDoing)

  // 7. confirm
  r = await jsonRequest(port, '/api/idea/confirm', 'POST', token)
  assert.equal(r.body.idea.stage, 'confirmed')

  await handle.close()

  // 8. restart with same storeDir -> confirmation persists
  handle = await startServer()
  port = handle.port
  r = await jsonRequest(port, '/api/idea/state', 'GET', handle.requestToken)
  assert.equal(r.body.idea.stage, 'confirmed')
  assert.ok(r.body.idea.agreement)
  await handle.close()
  provider.close()
})
