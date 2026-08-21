#!/usr/bin/env node
/**
 * Debug the agreement stage for a case whose synthesis succeeded.
 * Prints the raw provider content of the AGREEMENT call.
 *
 * Credentials come ONLY from the environment:
 *   MING_SYNTHESIS_BASE_URL, MING_SYNTHESIS_API_KEY, MING_SYNTHESIS_MODEL
 */
import { fileURLToPath } from 'node:url'

import {
  beginIdea, chooseEntry, createLetterIdea, appendHumanTurn, applySynthesis,
} from '../.tmp/idea/index.js'
import { CORPUS } from '../validation/real-synthesis-corpus/corpus.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const apiKey = process.env.MING_SYNTHESIS_API_KEY ?? ''
const baseUrl = process.env.MING_SYNTHESIS_BASE_URL ?? ''
const model = process.env.MING_SYNTHESIS_MODEL ?? ''
if (!apiKey || !baseUrl || !model) {
  console.error('Set MING_SYNTHESIS_BASE_URL / MING_SYNTHESIS_API_KEY / MING_SYNTHESIS_MODEL in the environment.')
  process.exit(2)
}

const caseId = process.argv[2] ?? 'photo-album'
const c = CORPUS.find((x) => x.id === caseId)

let idea = createLetterIdea('2026-08-21T09:00:00.000Z')
idea = beginIdea(idea)
idea = chooseEntry(idea, c.entry, '2026-08-21T09:00:00.001Z')
for (const t of c.turns) idea = appendHumanTurn(idea, t)
// Hardcode the synthesis from the previous successful run so the agreement
// call can be reproduced deterministically.
idea = applySynthesis(idea, {
  desiredReality: '把手机里上万张照片里孩子从小到大的成长照片挑出来，做成一本相册打印出来给老人看',
  strengths: ['手机相册已经可以按人自动分，但不全', '不想一张张手动挑，希望按时间或按人自动分', '已经有明确的目标：打印实体相册给老人翻看'],
  path: ['先按手机相册已有的「人」分组，定位出孩子的照片集合', '按时间排序，铺出孩子从小到大的成长线', '把选中的照片排成相册页，可以直接打印'],
  recommendation: '一个能按时间快速筛出孩子照片、排成可打印相册页的小工具',
}, '明白了，先做这件事。', new Date().toISOString())

const AGREEMENT_SYSTEM_PROMPT = `你是 Ming Workbench，正在为刚才的对话写「这一轮怎么开始」的约定。
必须包含四句话（用普通人的语言）：
- willGet：这一轮会得到什么
- solves：它解决什么问题
- whereSee：你会在哪里看到 / 怎么使用它
- notDoing：这一轮明确不做什么
只输出 JSON：{"willGet": string, "solves": string, "whereSee": string, "notDoing": string}。
标记：MING_HUMAN_FIRST_AGREEMENT`

const lines = idea.turns.map((turn) => `${turn.role === 'human' ? '这个人说' : 'Workbench 说'}：${turn.text}`)
const user = `${idea.entry ? `ta 的选择：${idea.entry}` : ''}\n${lines.join('\n')}`.trim()

const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ model, messages: [{ role: 'system', content: AGREEMENT_SYSTEM_PROMPT }, { role: 'user', content: user }], temperature: 0.2, max_tokens: 2048 }),
})
const body = await res.json()
console.log('=== raw agreement content ===')
console.log(body.choices?.[0]?.message?.content ?? JSON.stringify(body).slice(0, 1000))