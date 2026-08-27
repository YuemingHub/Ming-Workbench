/**
 * Human-first V1 entry — thin loopback server.
 *
 * Serves the human-first letter/conversation UI and the Idea Space API for a
 * person with no project. No Harness, AAOP, repository, or execution runtime is
 * started here: conversation synthesis reuses the provider endpoint passed
 * through the backend env, and state persists to the store directory.
 */

import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import {
  appendHumanTurn,
  applyAgreement,
  applySynthesis,
  beginIdea,
  chooseEntry,
  confirmIdea,
  type HumanFirstIdea,
} from './idea-space.js'
import {
  clearProviderSecretFile,
  loadIdea,
  loadProviderPreferencesFile,
  loadProviderSecretFile,
  saveIdea,
  saveProviderPreferencesFile,
  saveProviderSecretFile,
  type ProviderPreferences,
} from './persistence.js'
import {
  synthesizeAgreement,
  synthesizeTurn,
  type ProviderEndpoint,
} from './synthesis.js'
import {
  HUMAN_FIRST_APP_JS,
  HUMAN_FIRST_CSS,
  renderHumanFirstHtml,
} from './human-first-ui.js'

const LOOPBACK_HOST = '127.0.0.1'
const MAX_JSON_BODY_BYTES = 64 * 1024

function buildProviderEndpoint(
  envOverride: ProviderEndpoint | undefined,
  storeDir: string | undefined,
): ProviderEndpoint | undefined {
  // Environment override takes precedence (e.g. desktop mode where Electron
  // already resolved the credentials). Otherwise read from file storage so
  // runtime UI changes take effect immediately.
  if (storeDir) {
    const secret = loadProviderSecretFile(storeDir)
    const prefs = loadProviderPreferencesFile(storeDir)
    if (secret) {
      const baseUrl = prefs.baseUrl || 'https://api.deepseek.com/v1'
      const model = prefs.model || 'deepseek-v4-pro'
      return { baseUrl, apiKey: secret, model }
    }
  }
  if (envOverride && envOverride.apiKey) return envOverride
  return envOverride
}

export interface HumanFirstServerOptions {
  workbenchRoot: string
  provider?: ProviderEndpoint
  storeDir?: string
  port?: number
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
  // Opaque origins ("null") come from file:// or sandboxed iframes — they
  // cannot be read or reused by cross-site scripts so they are safe to allow.
  if (!origin || origin === 'null') return true
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
  const envProvider = options.provider
  const requestedPort = options.port ?? 0
  const requestToken = randomBytes(24).toString('base64url')
  let boundPort = -1

  function persist(idea: HumanFirstIdea): HumanFirstIdea {
    if (storeDir) saveIdea(storeDir, idea)
    return idea
  }

  function currentProvider(): ProviderEndpoint | undefined {
    return buildProviderEndpoint(envProvider, storeDir)
  }

  const server = createServer(async (request, response) => {
    try {
      const _pathname = request.url?.split('?')[0] ?? '/';
      const _method = request.method ?? 'GET';
      const _host = request.headers.host;
      const _origin = request.headers.origin as string | undefined;
      const _tokenHeader = request.headers['x-workbench-token'];
      console.error(`[HF-DEBUG] ${_method} ${_pathname} host=${_host} origin=${_origin ?? '(none)'} tokenHeader=${_tokenHeader ? 'present' : 'MISSING'}`);

      if (!safeHostHeader(request.headers.host, boundPort)) {
        console.error(`[HF-DEBUG] → 400 bad host header`);
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

      if (!url.pathname.startsWith('/api/')) {
        sendJson(response, 404, { status: 'not-found' })
        return
      }
      const tokenOk = hasRequestToken(request, requestToken);
      console.error(`[HF-DEBUG] tokenCheck=${tokenOk ? 'OK' : 'FAIL'}`);
      if (!tokenOk) {
        sendJson(response, 403, { status: 'forbidden' })
        return
      }

      if (method === 'GET' && url.pathname === '/api/idea/state') {
        const idea = loadIdea(storeDir ?? '')
        sendJson(response, 200, { status: 'ok', idea })
        return
      }

      const originOk = sameLoopbackOrigin(request.headers.origin, boundPort);
      console.error(`[HF-DEBUG] originCheck=${originOk ? 'OK' : 'FAIL'} (origin=${_origin ?? '(none)'})`);
      if (method === 'POST' && !originOk) {
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
          const result = await synthesizeTurn(currentProvider(), idea)
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
          const agreement = await synthesizeAgreement(currentProvider(), idea)
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

      // ── Provider config endpoints ────────────────────────────────────────

      if (method === 'GET' && url.pathname === '/api/provider/state') {
        const hasSecret = Boolean(storeDir && loadProviderSecretFile(storeDir))
        const preferences = storeDir
          ? loadProviderPreferencesFile(storeDir)
          : { provider: 'deepseek-official', model: '', baseUrl: '' }
        // Strip secret from preferences — it's never returned to the client.
        const publicPrefs = { provider: preferences.provider, model: preferences.model, baseUrl: preferences.baseUrl }
        sendJson(response, 200, { status: 'ok', hasSecret, preferences: publicPrefs })
        return
      }

      if (method === 'POST' && !sameLoopbackOrigin(request.headers.origin, boundPort)) {
        sendJson(response, 403, { status: 'forbidden' })
        return
      }

      if (method === 'POST' && url.pathname === '/api/provider/save') {
        const bodyObj = body as { provider?: unknown; model?: unknown; baseUrl?: unknown; key?: unknown } | undefined
        if (!bodyObj || typeof bodyObj !== 'object') {
          sendJson(response, 400, { status: 'bad-request' })
          return
        }
        const model = typeof bodyObj.model === 'string' ? bodyObj.model.trim() : ''
        const baseUrl = typeof bodyObj.baseUrl === 'string' ? bodyObj.baseUrl.trim() : ''
        const provider = typeof bodyObj.provider === 'string' ? bodyObj.provider.trim() : 'deepseek-official'
        if (!model) {
          sendJson(response, 400, { status: 'bad-request', message: 'model 是必填的' })
          return
        }
        if (baseUrl && !/^https?:\/\//i.test(baseUrl)) {
          sendJson(response, 400, { status: 'bad-request', message: '接口地址需要以 http:// 或 https:// 开头' })
          return
        }
        const prefs: ProviderPreferences = { provider, model, baseUrl }
        if (storeDir) {
          saveProviderPreferencesFile(storeDir, prefs)
          if (typeof bodyObj.key === 'string' && bodyObj.key.trim()) {
            saveProviderSecretFile(storeDir, bodyObj.key.trim())
          }
        }
        sendJson(response, 200, { status: 'ok' })
        return
      }

      if (method === 'POST' && url.pathname === '/api/provider/clear') {
        if (storeDir) clearProviderSecretFile(storeDir)
        sendJson(response, 200, { status: 'ok' })
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
