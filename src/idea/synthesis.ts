/**
 * Human-first V1 entry — conversation synthesis over the existing provider
 * endpoint. Reuses the provider primitives the desktop shell already owns
 * (base URL / model / credential passed through the backend env); it does not
 * start Harness, AAOP, or any execution runtime.
 *
 * The provider chat endpoint is OpenAI-compatible /chat/completions. The
 * repository-owned deterministic fixture (scripts/provider-fixture-server.mjs)
 * recognizes the prompt markers and returns stable JSON, so the installed
 * acceptance journey is deterministic. Real providers return genuine grounded
 * synthesis.
 */

import { z } from 'zod'

import type { HumanFirstIdea, IdeaSynthesis, RoundAgreement } from './idea-space.js'

export interface ProviderEndpoint {
  baseUrl: string
  apiKey: string
  model: string
}

export interface HumanFirstTurnResult {
  reply: string
  ready: boolean
  synthesis?: IdeaSynthesis
}

const synthesisSchema = z.object({
  desiredReality: z.string().min(1),
  strengths: z.array(z.string().min(1)).min(1),
  path: z.array(z.string().min(1)).min(1),
  recommendation: z.string().min(1),
})

const turnSchema = z.object({
  reply: z.string().min(1),
  ready: z.boolean(),
  synthesis: synthesisSchema.optional(),
})

const agreementSchema = z.object({
  willGet: z.string().min(1),
  solves: z.string().min(1),
  whereSee: z.string().min(1),
  notDoing: z.string().min(1),
})

const TURN_MARKER = 'MING_HUMAN_FIRST_TURN'
const AGREEMENT_MARKER = 'MING_HUMAN_FIRST_AGREEMENT'

const TURN_SYSTEM_PROMPT = `你是 Ming Workbench 的引导助手，正在帮助一个完全不懂软件开发的人想清楚一件想做成的小事。
规则：
- 用普通人的语言，简短、友善、不堆术语。
- 一次只推进一小步，先理解，不要一次问一堆问题。
- 只有当信息足够把「想达到的目的」「ta 已经带来的东西」「一步步的路径」「建议先做的一件最小完整结果」都说清楚时，ready 才为 true，并填 synthesis。
- synthesis 的每一项都必须来自这个人说过的话，绝不编造 ta 没提到的资源。
- recommendation 必须是一个最小的、完整的、普通人能看见和使用的成果，绝不是一个工程组件。
- 只输出 JSON：{"reply": string, "ready": boolean, "synthesis": {"desiredReality": string, "strengths": string[], "path": string[], "recommendation": string}}。
标记：${TURN_MARKER}`

const AGREEMENT_SYSTEM_PROMPT = `你是 Ming Workbench，正在为刚才的对话写「这一轮怎么开始」的约定。
必须包含四句话（用普通人的语言）：
- willGet：这一轮会得到什么
- solves：它解决什么问题
- whereSee：你会在哪里看到 / 怎么使用它
- notDoing：这一轮明确不做什么
只输出 JSON：{"willGet": string, "solves": string, "whereSee": string, "notDoing": string}。
标记：${AGREEMENT_MARKER}`

// Real providers occasionally answer with helpful prose even when the
// existing contract asks for JSON. Keep the recovery bounded and local to the
// provider seam; this does not change the Idea Space schema or conversation
// semantics.
const TURN_FORMAT_REPAIR_PROMPT = `${TURN_SYSTEM_PROMPT}
上一次响应无法按约定解析。请重新回答，严格只输出一个合法 JSON 对象，不要解释、不要 Markdown 代码围栏，不要在 JSON 前后添加任何文字。`

const AGREEMENT_FORMAT_REPAIR_PROMPT = `${AGREEMENT_SYSTEM_PROMPT}
上一次响应无法按约定解析。请重新回答，严格只输出一个合法 JSON 对象，不要解释、不要 Markdown 代码围栏，不要在 JSON 前后添加任何文字。`

function conversationTranscript(idea: HumanFirstIdea): string {
  const lines = idea.turns.map((turn) => {
    const who = turn.role === 'human' ? '这个人说' : 'Workbench 说'
    return `${who}：${turn.text}`
  })
  const entryLine = idea.entry ? `ta 的选择：${idea.entry}` : ''
  return `${entryLine}\n${lines.join('\n')}`.trim()
}

function parseJsonObject(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim()
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
  } catch {
    // fall through to code-fence extraction
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) {
    try {
      const parsed: unknown = JSON.parse(fenced[1].trim())
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
    } catch {
      return undefined
    }
  }
  return undefined
}

function parseTurnResult(content: string): HumanFirstTurnResult | undefined {
  const parsed = parseJsonObject(content)
  if (!parsed) return undefined
  const result = turnSchema.safeParse(parsed)
  if (!result.success) return undefined
  return result.data
}

function parseAgreementResult(content: string): RoundAgreement | undefined {
  const parsed = parseJsonObject(content)
  const result = agreementSchema.safeParse(parsed ?? {})
  return result.success ? result.data : undefined
}

async function callChatCompletions(
  endpoint: ProviderEndpoint,
  systemPrompt: string,
  transcript: string,
  timeoutMs = 45_000,
): Promise<string> {
  const url = `${endpoint.baseUrl.replace(/\/$/, '')}/chat/completions`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${endpoint.apiKey}`,
    },
    body: JSON.stringify({
      model: endpoint.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: transcript },
      ],
      temperature: 0.2,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) {
    throw new Error(`provider chat failed (${response.status})`)
  }
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> }
  const content = body.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.length === 0) {
    throw new Error('provider chat returned no content')
  }
  return content
}

const NO_PROVIDER_REPLY =
  '我先把你说的话记下了。要继续帮你把这件事想清楚，我还需要连上一个 AI 助手。这一步准备好之后，我们再接着聊。'

export function hasProvider(endpoint: ProviderEndpoint | undefined): boolean {
  return Boolean(
    endpoint && endpoint.baseUrl && endpoint.apiKey && endpoint.model,
  )
}

/**
 * One conversation turn. Appends a grounded Workbench reply; when the model
 * judges the information is enough, returns ready=true with a synthesis the
 * UI renders as the four pre-confirmation review blocks.
 */
export async function synthesizeTurn(
  endpoint: ProviderEndpoint | undefined,
  idea: HumanFirstIdea,
): Promise<HumanFirstTurnResult> {
  if (!hasProvider(endpoint)) {
    return { reply: NO_PROVIDER_REPLY, ready: false }
  }
  const transcript = conversationTranscript(idea)
  const content = await callChatCompletions(endpoint!, TURN_SYSTEM_PROMPT, transcript)
  let result = parseTurnResult(content)
  if (!result) {
    const repaired = await callChatCompletions(endpoint!, TURN_FORMAT_REPAIR_PROMPT, transcript)
    result = parseTurnResult(repaired)
  }
  if (!result) {
    return { reply: '我还在理解你说的这件事，我们再往前说一步就好。', ready: false }
  }
  if (!result.ready) {
    return { reply: result.reply, ready: false }
  }
  return { reply: result.reply, ready: true, synthesis: result.synthesis }
}

/** Round Agreement — the four required semantics shown before confirmation. */
export async function synthesizeAgreement(
  endpoint: ProviderEndpoint | undefined,
  idea: HumanFirstIdea,
): Promise<RoundAgreement> {
  if (!hasProvider(endpoint) || !idea.synthesis) {
    throw new Error('Round agreement requires provider and synthesis')
  }
  const transcript = conversationTranscript(idea)
  const content = await callChatCompletions(endpoint!, AGREEMENT_SYSTEM_PROMPT, transcript)
  let result = parseAgreementResult(content)
  if (!result) {
    const repaired = await callChatCompletions(endpoint!, AGREEMENT_FORMAT_REPAIR_PROMPT, transcript)
    result = parseAgreementResult(repaired)
  }
  if (!result) throw new Error('provider returned an unusable round agreement')
  return result
}
