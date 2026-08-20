/**
 * Human-first V1 entry — thin loopback server.
 *
 * Serves the human-first letter/conversation UI and the Idea Space API for a
 * person with no project. Conversation synthesis reuses the provider endpoint
 * passed through the backend env, and state persists to the store directory.
 * Execution-side Harness preparation is deferred until after confirmation and
 * an explicit execution request.
 */

import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { join, resolve, sep } from 'node:path'

import {
  appendHumanTurn,
  applyAgreement,
  applyExecution,
  applySynthesis,
  beginIdea,
  chooseEntry,
  confirmIdea,
  clearExecution,
  type HumanFirstIdea,
  type IdeaExecution,
} from './idea-space.js'
import { loadIdea, saveIdea } from './persistence.js'
import {
  synthesizeAgreement,
  synthesizeTurn,
  type ProviderEndpoint,
} from './synthesis.js'
import { executeFirstOutcome } from '../execution/first-outcome-executor.js'
import { prepareHarnessRuntime } from '../hosts/harness-runtime.js'
import {
  HUMAN_FIRST_APP_JS,
  HUMAN_FIRST_CSS,
  renderHumanFirstHtml,
} from './human-first-ui.js'

const LOOPBACK_HOST = '127.0.0.1'
const MAX_JSON_BODY_BYTES = 64 * 1024

export interface HumanFirstServerOptions {
  workbenchRoot: string
  provider?: ProviderEndpoint
  storeDir?: string
  port?: number
  /** Reviewed Harness checkout used only when the founder executes a round. */
  harnessCheckout?: string
  /** Parent dir for Workbench-owned result workspaces (defaults under storeDir). */
  resultsRoot?: string
}

export interface HumanFirstServerHandle {
  url: string
  port: number
  requestToken: string
  close(): Promise<void>
}

function setSecurityHeaders(response: ServerResponse): void {
  response.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  )
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('Referrer-Policy', 'no-referrer')
  response.setHeader('Cache-Control', 'no-store')
}

function sendText(
  response: ServerResponse,
  statusCode: number,
  contentType: string,
  body: string,
): void {
  setSecurityHeaders(response)
  response.statusCode = statusCode
  response.setHeader('Content-Type', contentType)
  response.end(body)
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  sendText(
    response,
    statusCode,
    'application/json; charset=utf-8',
    `${JSON.stringify(body)}\n`,
  )
}

function safeHostHeader(host: string | undefined, port: number): boolean {
  if (!host) return false
  const normalized = host.trim().toLowerCase()
  return normalized === `${LOOPBACK_HOST}:${port}` || normalized === `localhost:${port}`
}

function sameLoopbackOrigin(origin: string | undefined, port: number): boolean {
  if (!origin) return true
  try {
    const parsed = new URL(origin)
    if (parsed.protocol !== 'http:') return false
    if (parsed.port !== String(port)) return false
    return parsed.hostname === LOOPBACK_HOST || parsed.hostname === 'localhost'
  } catch {
    return false
  }
}

function hasRequestToken(request: IncomingMessage, requestToken: string): boolean {
  return request.headers['x-workbench-token'] === requestToken
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_JSON_BODY_BYTES) {
        rejectPromise(new Error('request-body-too-large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw.trim()) {
        resolvePromise(undefined)
        return
      }
      try {
        resolvePromise(JSON.parse(raw))
      } catch {
        rejectPromise(new Error('invalid-json'))
      }
    })
    request.on('error', () => rejectPromise(new Error('request-error')))
  })
}

export async function startHumanFirstServer(
  options: HumanFirstServerOptions,
): Promise<HumanFirstServerHandle> {
  const storeDir = options.storeDir
  const provider = options.provider
  const requestedPort = options.port ?? 0
  const requestToken = randomBytes(24).toString('base64url')
  const resultsRoot =
    options.resultsRoot ?? join(options.storeDir ?? options.workbenchRoot, 'results')
  let boundPort = -1

  function persist(idea: HumanFirstIdea): HumanFirstIdea {
    if (storeDir) saveIdea(storeDir, idea)
    return idea
  }

  const server = createServer(async (request, response) => {
    try {
      if (!safeHostHeader(request.headers.host, boundPort)) {
        sendJson(response, 400, { status: 'bad-request' })
        return
      }
      const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
      const method = request.method ?? 'GET'

      if (method === 'GET' && url.pathname === '/') {
        sendText(response, 200, 'text/html; charset=utf-8', renderHumanFirstHtml(requestToken))
        return
      }
      if (method === 'GET' && url.pathname === '/style.css') {
        sendText(response, 200, 'text/css; charset=utf-8', HUMAN_FIRST_CSS)
        return
      }
      if (method === 'GET' && url.pathname === '/app.js') {
        sendText(response, 200, 'text/javascript; charset=utf-8', HUMAN_FIRST_APP_JS)
        return
      }

      if (method === 'GET' && url.pathname === '/result') {
        // Browser navigation is not an /api/* request. Keep the artifact
        // path restricted to this Workbench-owned results root.
        const idea = loadIdea(storeDir ?? '')
        const artifact = idea.execution?.artifactPath
        if (!artifact) {
          sendJson(response, 404, { status: 'no-result' })
          return
        }
        const resolvedRoot = resolve(resultsRoot)
        const resolvedArtifact = resolve(artifact)
        if (resolvedRoot === '' || !resolvedArtifact.startsWith(resolvedRoot + sep) || !existsSync(resolvedArtifact)) {
          sendJson(response, 404, { status: 'result-not-found' })
          return
        }
        try {
          const html = readFileSync(resolvedArtifact, 'utf8')
          sendText(response, 200, 'text/html; charset=utf-8', html)
        } catch {
          sendJson(response, 404, { status: 'result-unreadable' })
        }
        return
      }

      if (!url.pathname.startsWith('/api/')) {
        sendJson(response, 404, { status: 'not-found' })
        return
      }
      if (!hasRequestToken(request, requestToken)) {
        sendJson(response, 403, { status: 'forbidden' })
        return
      }

      if (method === 'GET' && url.pathname === '/api/idea/state') {
        const idea = loadIdea(storeDir ?? '')
        sendJson(response, 200, { status: 'ok', idea })
        return
      }

      if (method === 'POST' && !sameLoopbackOrigin(request.headers.origin, boundPort)) {
        sendJson(response, 403, { status: 'forbidden' })
        return
      }

      let body: unknown
      if (method === 'POST') {
        try {
          body = await readJsonBody(request)
        } catch {
          sendJson(response, 400, { status: 'bad-request' })
          return
        }
      }

      if (method === 'POST' && url.pathname === '/api/idea/start') {
        const idea = beginIdea(loadIdea(storeDir ?? ''))
        persist(idea)
        sendJson(response, 200, { status: 'ok', idea })
        return
      }

      if (method === 'POST' && url.pathname === '/api/idea/entry') {
        const entry = (body as { entry?: unknown } | undefined)?.entry
        if (typeof entry !== 'string') {
          sendJson(response, 400, { status: 'bad-request' })
          return
        }
        try {
          const idea = chooseEntry(loadIdea(storeDir ?? ''), entry)
          persist(idea)
          sendJson(response, 200, { status: 'ok', idea })
        } catch {
          sendJson(response, 400, { status: 'bad-request' })
        }
        return
      }

      if (method === 'POST' && url.pathname === '/api/idea/message') {
        const text = (body as { text?: unknown } | undefined)?.text
        if (typeof text !== 'string' || text.trim().length === 0) {
          sendJson(response, 400, { status: 'bad-request' })
          return
        }
        let idea = appendHumanTurn(loadIdea(storeDir ?? ''), text)
        try {
          const result = await synthesizeTurn(provider, idea)
          if (result.ready && result.synthesis) {
            idea = applySynthesis(idea, result.synthesis, result.reply)
            idea.providerRequired = false
          } else {
            idea = { ...idea, turns: [...idea.turns, { role: 'workbench' as const, text: result.reply, at: new Date().toISOString() }] }
            idea.providerRequired = !result.ready
          }
        } catch {
          idea = {
            ...idea,
            turns: [
              ...idea.turns,
              {
                role: 'workbench' as const,
                text: '我这边一下没接上，我们再说一次刚才那句，好吗？',
                at: new Date().toISOString(),
              },
            ],
          }
          idea.providerRequired = true
        }
        persist(idea)
        sendJson(response, 200, { status: 'ok', idea })
        return
      }

      if (method === 'POST' && url.pathname === '/api/idea/agreement') {
        const idea = loadIdea(storeDir ?? '')
        try {
          const agreement = await synthesizeAgreement(provider, idea)
          const next = applyAgreement(
            idea,
            agreement,
            '这一轮我们这样开始。你看过之后，如果没问题，我们就说好。',
          )
          persist(next)
          sendJson(response, 200, { status: 'ok', idea: next })
        } catch {
          sendJson(response, 409, { status: 'agreement-unavailable' })
        }
        return
      }

      if (method === 'POST' && url.pathname === '/api/idea/confirm') {
        const idea = loadIdea(storeDir ?? '')
        try {
          const next = confirmIdea(idea)
          persist(next)
          sendJson(response, 200, { status: 'ok', idea: next })
        } catch {
          sendJson(response, 409, { status: 'not-ready' })
        }
        return
      }

      if (method === 'POST' && url.pathname === '/api/idea/execute') {
        const idea = loadIdea(storeDir ?? '')
        if (idea.stage !== 'confirmed') {
          sendJson(response, 409, { status: 'not-confirmed' })
          return
        }
        if (!provider || !provider.apiKey) {
          sendJson(response, 409, { status: 'provider-required' })
          return
        }
        const authorizeRealExecution = (body as { authorizeRealExecution?: unknown } | undefined)
          ?.authorizeRealExecution === true
        const fixtureRequested = (body as { fixture?: unknown } | undefined)?.fixture === true
        // A browser/body flag can never self-authorize deterministic evidence.
        // Fixture mode is only available to the repository-owned automation
        // environment, which sets the process-level marker. The first click
        // still reaches the normal cost gate; the authorized confirmation is
        // what allows the installed fixture journey to enter deterministic
        // mode without exposing a fixture control in the human UI.
        const fixtureMarker = process.env.MING_EXECUTION_FIXTURE === '1'
        const fixture = fixtureMarker && (fixtureRequested || authorizeRealExecution)
        const executionMode = fixture ? 'fixture' : 'real'
        const now = new Date()
        // Human Cost Gate: the FIRST real execution may incur API fees. It is
        // only run after the founder explicitly authorizes it. Fixture mode
        // (CI only) needs no cost gate.
        if (executionMode === 'real' && !authorizeRealExecution) {
          sendJson(response, 409, {
            status: 'cost-gate-required',
            message:
              '接下来会调用你连接的 AI 服务来实际制作这个结果，可能产生额外费用。你确认后我才会开始。',
          })
          return
        }
        let harnessCheckout = options.harnessCheckout
        if (!harnessCheckout || !existsSync(harnessCheckout)) {
          try {
            const runtime = await prepareHarnessRuntime({ workbenchRoot: options.workbenchRoot })
            harnessCheckout = runtime.checkout
          } catch {
            sendJson(response, 409, { status: 'harness-required' })
            return
          }
        }
        try {
          const execResult = await executeFirstOutcome({
            idea,
            workbenchRoot: options.workbenchRoot,
            workspaceRoot: resultsRoot,
            harnessCheckout,
            provider: process.env.MING_HARNESS_PROVIDER ?? 'deepseek-official',
            model: process.env.MING_HARNESS_MODEL ?? provider.model ?? 'deepseek-chat',
            sessionRoot: process.env.MING_WORKBENCH_SESSION_ROOT,
            now: () => now,
            mode: executionMode,
            authorizeRealExecution,
          })
          const honesty = executionMode === 'fixture' ? 'DETERMINISTIC' : 'REAL'
          const execution: IdeaExecution = {
            status:
              execResult.outcome.status === 'unsupported'
                ? 'unsupported'
                : execResult.outcome.status,
            mode: executionMode,
            honesty,
            summary: execResult.summary,
            verifiedFacts: execResult.verifiedFacts,
            notProvenFacts: execResult.notProvenFacts,
            producedFiles: execResult.producedFiles,
            capabilityDecision: execResult.capabilityDecision,
            artifactPath: execResult.artifactPath,
            workspacePath: execResult.workspacePath,
            workUnitId: execResult.workUnitId,
            detail: execResult.detail,
            at: now.toISOString(),
          }
          const next = applyExecution(idea, execution)
          persist(next)
          sendJson(response, 200, { status: 'ok', idea: next, execution })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendJson(response, executionMode === 'real' && !authorizeRealExecution ? 409 : 500, {
            status: 'execution-failed',
            message,
          })
        }
        return
      }

      if (method === 'POST' && url.pathname === '/api/idea/iterate') {
        const idea = loadIdea(storeDir ?? '')
        const next = clearExecution(idea)
        persist(next)
        sendJson(response, 200, { status: 'ok', idea: next })
        return
      }

      sendJson(response, 404, { status: 'not-found' })
    } catch {
      sendJson(response, 500, { status: 'internal-error' })
    }
  })

  await new Promise<void>((resolvePromise) => {
    server.listen(requestedPort, LOOPBACK_HOST, () => resolvePromise())
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('human-first server failed to bind')
  }
  boundPort = address.port
  const url = `http://${LOOPBACK_HOST}:${boundPort}`

  return {
    url,
    port: boundPort,
    requestToken,
    close: () =>
      new Promise<void>((resolvePromise) => {
        server.close(() => resolvePromise())
      }),
  }
}
