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

/**
 * Minimal provider injection seam for idea-space synthesis.
 *
 * The default implementation is the OpenAI-compatible HTTP chat endpoint the
 * desktop shell already owns. Injecting a SynthesisProvider lets the Workbench
 * Outcome stage be exercised with a deterministic / mock / failure provider
 * without a network credential, without changing the Outcome schema, and
 * without touching the Work Unit or any downstream Workbench logic. This is the
 * single seam that lets the synthesis intelligence be replaced (or doubled) in
 * isolation — the only Workbench-side gap that previously blocked a fully
 * provider-doubled real-user intent test.
 */
export interface SynthesisProvider {
  complete(systemPrompt: string, userContent: string): Promise<string>
}

/** Default provider: the real OpenAI-compatible HTTP chat endpoint. */
export function createHttpSynthesisProvider(endpoint: ProviderEndpoint): SynthesisProvider {
  return {
    complete: (systemPrompt, userContent) => callChatCompletions(endpoint, systemPrompt, userContent),
  }
}

export interface HumanFirstTurnResult {
  reply: string
  ready: boolean
  synthesis?: IdeaSynthesis
  /** The provider's raw content, retained for validation records. */
  rawContent?: string
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
- ta「已经带来的东西」指 ta 在对话里说过的痛点、想法、边界；不需要 ta 说出具体用什么工具，也不要去追问 ta 现在用什么软件。
- synthesis 的每一项都必须来自这个人说过的话，绝不编造 ta 没提到的资源。
- recommendation 必须是一个最小的、完整的、普通人能看见和使用的成果，绝不是一个工程组件。
- 收敛规则（重要）：第 1 轮最多问一个最关键的问题；第 2 轮开始，无论 ta 怎么回答，都必须 ready 为 true 并给出 synthesis——没确定的小细节用「先按通常做法假设」处理，并把假设写进 recommendation，让 ta 在确认页改。绝不进入「每轮一问、永不收敛」的循环。
- 只输出 JSON：{"reply": string, "ready": boolean, "synthesis": {"desiredReality": string, "strengths": string[], "path": string[], "recommendation": string}}。
- ready 为 false 时：只输出 reply 和 ready 两个字段，不要输出 synthesis（空对象也不行）。
标记：${TURN_MARKER}`

const AGREEMENT_SYSTEM_PROMPT = `你是 Ming Workbench，正在为刚才的对话写「这一轮怎么开始」的约定。
必须包含四句话（用普通人的语言）：
- willGet：这一轮会得到什么
- solves：它解决什么问题
- whereSee：你会在哪里看到 / 怎么使用它
- notDoing：这一轮明确不做什么
只输出一个 JSON 对象，包含且仅包含这四个字段，不要包含任何其它字段或字样（包括这里提到的标记：${AGREEMENT_MARKER}）。
标记：${AGREEMENT_MARKER}`

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

async function callChatCompletions(
  endpoint: ProviderEndpoint,
  systemPrompt: string,
  transcript: string,
  timeoutMs = 45_000,
  maxTokens = 2048,
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
      // Some OpenAI-compatible providers default max_tokens low enough to
      // truncate the synthesis JSON mid-object, which then fails to parse and
      // silently degrades to "not ready". Request enough headroom for the
      // small structured synthesis + agreement payloads.
      max_tokens: maxTokens,
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
 * Resolve the active synthesis provider. An injected provider wins; otherwise the
 * real HTTP provider is used when an endpoint is configured; otherwise none.
 * Callers that inject a provider need no endpoint at all.
 */
function resolveSynthesisProvider(
  endpoint: ProviderEndpoint | undefined,
  provider?: SynthesisProvider,
): SynthesisProvider | undefined {
  if (provider) return provider
  if (hasProvider(endpoint)) return createHttpSynthesisProvider(endpoint!)
  return undefined
}

/**
 * One conversation turn. Appends a grounded Workbench reply; when the model
 * judges the information is enough, returns ready=true with a synthesis the
 * UI renders as the four pre-confirmation review blocks.
 */
export async function synthesizeTurn(
  endpoint: ProviderEndpoint | undefined,
  idea: HumanFirstIdea,
  provider?: SynthesisProvider,
): Promise<HumanFirstTurnResult> {
  const activeProvider = resolveSynthesisProvider(endpoint, provider)
  if (!activeProvider) {
    return { reply: NO_PROVIDER_REPLY, ready: false }
  }
  const transcript = conversationTranscript(idea)
  const content = await activeProvider.complete(TURN_SYSTEM_PROMPT, transcript)
  const parsed = parseJsonObject(content)
  if (!parsed) {
    return { reply: '我还在理解你说的这件事，我们再往前说一步就好。', ready: false, rawContent: content }
  }
  // ready=false only needs reply + ready. Some providers still emit an empty
  // synthesis object (schema-shaped but blank) alongside ready=false; the
  // strict synthesis schema would reject that payload and swallow the model's
  // actual clarifying question. Preserve it.
  const loose = z.object({ reply: z.string().min(1), ready: z.boolean() }).safeParse(parsed)
  if (loose.success && !loose.data.ready) {
    return { reply: loose.data.reply, ready: false, rawContent: content }
  }
  const result = turnSchema.safeParse(parsed)
  if (!result.success) {
    return { reply: '我还在理解你说的这件事，我们再往前说一步就好。', ready: false, rawContent: content }
  }
  return { reply: result.data.reply, ready: true, synthesis: result.data.synthesis, rawContent: content }
}

export interface AgreementSynthResult {
  agreement: RoundAgreement
  /** The provider's raw content, retained for validation records. */
  rawContent: string
}

export async function synthesizeAgreementRaw(
  endpoint: ProviderEndpoint | undefined,
  idea: HumanFirstIdea,
  provider?: SynthesisProvider,
): Promise<AgreementSynthResult> {
  if (!idea.synthesis) {
    throw new Error('Round agreement requires synthesis')
  }
  const activeProvider = resolveSynthesisProvider(endpoint, provider)
  if (!activeProvider) {
    throw new Error('Round agreement requires a synthesis provider')
  }
  const transcript = conversationTranscript(idea)
  const content = await activeProvider.complete(AGREEMENT_SYSTEM_PROMPT, transcript)
  const parsed = parseJsonObject(content)
  const result = agreementSchema.safeParse(parsed ?? {})
  if (!result.success) {
    throw new Error('provider returned an unusable round agreement')
  }
  return { agreement: result.data, rawContent: content }
}

/** Round Agreement — the four required semantics shown before confirmation. */
export async function synthesizeAgreement(
  endpoint: ProviderEndpoint | undefined,
  idea: HumanFirstIdea,
  provider?: SynthesisProvider,
): Promise<RoundAgreement> {
  const result = await synthesizeAgreementRaw(endpoint, idea, provider)
  return result.agreement
}
