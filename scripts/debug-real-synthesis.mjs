#!/usr/bin/env node
/**
 * Diagnostic: print the RAW provider content for a given corpus case's final
 * turn so a not-ready / parse-failure can be attributed (model output vs
 * Workbench parsing). Run directly; never commits keys.
 *
 * Credentials come ONLY from the environment:
 *   MING_SYNTHESIS_BASE_URL, MING_SYNTHESIS_API_KEY, MING_SYNTHESIS_MODEL
 */
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const apiKey = process.env.MING_SYNTHESIS_API_KEY ?? ''
const baseUrl = process.env.MING_SYNTHESIS_BASE_URL ?? ''
const model = process.env.MING_SYNTHESIS_MODEL ?? ''
if (!apiKey || !baseUrl || !model) {
  console.error('Set MING_SYNTHESIS_BASE_URL / MING_SYNTHESIS_API_KEY / MING_SYNTHESIS_MODEL in the environment.')
  process.exit(2)
}

const TURN_SYSTEM_PROMPT = `你是 Ming Workbench 的引导助手，正在帮助一个完全不懂软件开发的人想清楚一件想做成的小事。
规则：
- 用普通人的语言，简短、友善、不堆术语。
- 一次只推进一小步，先理解，不要一次问一堆问题。
- 只有当信息足够把「想达到的目的」「ta 已经带来的东西」「一步步的路径」「建议先做的一件最小完整结果」都说清楚时，ready 才为 true，并填 synthesis。
- synthesis 的每一项都必须来自这个人说过的话，绝不编造 ta 没提到的资源。
- recommendation 必须是一个最小的、完整的、普通人能看见和使用的成果，绝不是一个工程组件。
- 只输出 JSON：{"reply": string, "ready": boolean, "synthesis": {"desiredReality": string, "strengths": string[], "path": string[], "recommendation": string}}。
标记：MING_HUMAN_FIRST_TURN`

const cases = {
  'family-records': ['我只有一点模糊念头', '家里那些零碎的，孩子今天说了句啥、要买啥、提醒老人吃药，老忘。想弄个小东西记下来，翻出来就能看', '不用太复杂，就我和家里人能随手记一笔、随时翻看就行，别整成那种要注册要登录的'],
  'reading-notes': ['我只有一点模糊念头', '一直想多看点书，但是看完就忘，过俩月跟没看过一样，想有点东西能留下', '不想搞得像上学交作业那样有压力，也不用什么打卡，就是看完能随手写两句感想，隔阵子能翻翻'],
  'cat-care': ['我已经有一个想法', '家里养了只猫，我老忘喂食换水，上次差点忘了带它打疫苗。想有个东西能提醒我这些事', '不要太复杂，就是到点了能提醒我一声，最好手机上看就行，不用电脑'],
  'photo-album': ['我已经有一个想法', '手机里照片攒了得有上万张，想挑出孩子从小到大的照片做成一本相册，打印出来给老人看', '不想一张张手动挑，那得挑到猴年马月，能有办法按时间或者按人分一下最好'],
}

const caseId = process.argv[2] ?? 'family-records'
const [entry, ...turns] = cases[caseId]
if (!entry) { console.error(`unknown case: ${caseId}`); process.exit(2) }

const user = `ta 的选择：${entry}\n${turns.map((t) => `这个人说：${t}`).join('\n')}`

const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ model, messages: [{ role: 'system', content: TURN_SYSTEM_PROMPT }, { role: 'user', content: user }], temperature: 0.2, max_tokens: 2048 }),
})
const body = await res.json()
console.log('=== raw content ===')
console.log(body.choices?.[0]?.message?.content ?? JSON.stringify(body).slice(0, 1000))
console.log('=== finish ===')
console.log(body.choices?.[0]?.finish_reason ?? 'n/a')
if (body.usage) console.log('usage:', JSON.stringify(body.usage))