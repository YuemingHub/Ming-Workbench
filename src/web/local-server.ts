import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { resolve } from 'node:path'
import {
  runDevelopmentIntakeApplication,
  type DevelopmentIntakeApplicationResult,
} from '../application/development-intake.js'
import {
  enableProjectAaop,
  type EnableProjectAaopResult,
} from '../projects/aaop-setup.js'
import {
  resolveProjectOnboarding,
  type ProjectOnboardingResult,
} from '../projects/onboarding.js'
import {
  LOCAL_WORKBENCH_APP_JS,
  LOCAL_WORKBENCH_CSS,
  renderLocalWorkbenchHtml,
} from './local-ui.js'
import {
  runBoundedExecution,
  validateExecutionPreconditions,
  type BoundedExecutionResult,
  type BoundedExecutionOptions,
} from '../execution/bounded-execution.js'

const LOOPBACK_HOST = '127.0.0.1'
const MAX_JSON_BODY_BYTES = 64 * 1024
const MAX_REQUEST_TEXT_CHARS = 10_000

export interface LocalWorkbenchServerOptions {
  /** Fixed local project selected before the server starts. Browser requests cannot replace it. */
  projectRoot: string
  workbenchRoot: string
  harnessCheckout: string
  provider?: string
  model?: string
  sessionRoot?: string
  port?: number
  providerSecret?: string
}

export interface LocalWorkbenchServerDependencies {
  resolveOnboarding?: (projectRoot: string) => ProjectOnboardingResult
  enableAaop?: (
    options: { projectRoot: string; authorized: boolean },
  ) => Promise<EnableProjectAaopResult>
  runIntake?: typeof runDevelopmentIntakeApplication
  logError?: (error: unknown) => void
}

export interface LocalWorkbenchServerHandle {
  url: string
  port: number
  /** Test/host integration surface. The normal start script must not print this token. */
  requestToken: string
  close(): Promise<void>
}

export interface LocalProjectSnapshot {
  status: 'ready' | 'setup-required' | 'blocked'
  project: {
    id: string
    title: string
  }
  aaopVersion?: string
  message: string
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
  const value = request.headers['x-ming-workbench-token']
  return typeof value === 'string' && value === requestToken
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const declared = request.headers['content-length']
  if (typeof declared === 'string') {
    const length = Number(declared)
    if (!Number.isFinite(length) || length < 0 || length > MAX_JSON_BODY_BYTES) {
      throw new Error('request-body-too-large')
    }
  }

  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += bytes.byteLength
    if (total > MAX_JSON_BODY_BYTES) {
      throw new Error('request-body-too-large')
    }
    chunks.push(bytes)
  }

  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new Error('invalid-json')
  }
}

function objectBody(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

export function projectOnboardingSnapshot(
  onboarding: ProjectOnboardingResult,
): LocalProjectSnapshot {
  if (onboarding.status === 'ready') {
    return {
      status: 'ready',
      project: {
        id: onboarding.project.id,
        title: onboarding.project.title,
      },
      aaopVersion: onboarding.aaopVersion,
      message: '项目已准备，可以先做只读理解。',
    }
  }
  if (onboarding.status === 'setup-required') {
    return {
      status: 'setup-required',
      project: {
        id: onboarding.project.id,
        title: onboarding.project.title,
      },
      message: '这个项目还没有启用 Workbench 的开发控制。启用后会先从只读理解开始。',
    }
  }
  return {
    status: 'blocked',
    project: {
      id: onboarding.project.id,
      title: onboarding.project.title,
    },
    message: onboarding.reason,
  }
}

function intakeUnavailable(originalRequest: string): Record<string, unknown> {
  return {
    status: 'intake-unavailable',
    request: originalRequest,
    retryable: true,
    message: '当前无法完成只读项目理解。你的原话已保留，可以稍后重试。',
  }
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    server.close((error) => {
      if (error) reject(error)
      else resolvePromise()
    })
  })
}

/**
 * Start the first Ming Workbench local product shell.
 *
 * The server deliberately binds only to 127.0.0.1 and fixes one project root at
 * startup. Browser requests can ask Workbench to act on that selected project,
 * but cannot submit another filesystem target. Stage B exposes onboarding,
 * explicitly authorized AAOP setup, and read-only Developer Intake only.
 */
export async function startLocalWorkbenchServer(
  options: LocalWorkbenchServerOptions,
  dependencies: LocalWorkbenchServerDependencies = {},
): Promise<LocalWorkbenchServerHandle> {
  const projectRoot = resolve(options.projectRoot)
  const workbenchRoot = resolve(options.workbenchRoot)
  const harnessCheckout = resolve(options.harnessCheckout)
  const resolveOnboarding = dependencies.resolveOnboarding ?? resolveProjectOnboarding
  const enableAaop = dependencies.enableAaop ?? enableProjectAaop
  const runIntake = dependencies.runIntake ?? runDevelopmentIntakeApplication
  const logError = dependencies.logError ?? ((error: unknown) => console.error(error))
  const requestToken = randomBytes(24).toString('base64url')
  let boundPort = -1

  const server = createServer(async (request, response) => {
    try {
      if (!safeHostHeader(request.headers.host, boundPort)) {
        sendJson(response, 400, {
          status: 'bad-request',
          message: 'Workbench 只接受当前本地窗口发出的请求。',
        })
        return
      }

      const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
      const method = request.method ?? 'GET'

      if (method === 'GET' && url.pathname === '/') {
        sendText(
          response,
          200,
          'text/html; charset=utf-8',
          renderLocalWorkbenchHtml(requestToken),
        )
        return
      }
      if (method === 'GET' && url.pathname === '/style.css') {
        sendText(response, 200, 'text/css; charset=utf-8', LOCAL_WORKBENCH_CSS)
        return
      }
      if (method === 'GET' && url.pathname === '/app.js') {
        sendText(response, 200, 'text/javascript; charset=utf-8', LOCAL_WORKBENCH_APP_JS)
        return
      }

      if (!url.pathname.startsWith('/api/')) {
        sendJson(response, 404, { status: 'not-found' })
        return
      }

      if (!hasRequestToken(request, requestToken)) {
        sendJson(response, 403, {
          status: 'forbidden',
          message: 'Workbench 拒绝了不是来自当前本地窗口的请求。',
        })
        return
      }

      if (method === 'POST' && !sameLoopbackOrigin(request.headers.origin, boundPort)) {
        sendJson(response, 403, {
          status: 'forbidden',
          message: 'Workbench 拒绝了不同来源的本地写请求。',
        })
        return
      }

      if (method === 'GET' && url.pathname === '/api/project') {
        sendJson(response, 200, projectOnboardingSnapshot(resolveOnboarding(projectRoot)))
        return
      }

      if (method === 'POST' && url.pathname === '/api/setup') {
        let parsed: unknown
        try {
          parsed = await readJsonBody(request)
        } catch (error) {
          const code = error instanceof Error ? error.message : ''
          sendJson(response, code === 'request-body-too-large' ? 413 : 400, {
            status: 'bad-request',
            message: code === 'request-body-too-large'
              ? '请求内容过大。'
              : 'Workbench 无法读取这次启用请求。',
          })
          return
        }
        const body = objectBody(parsed)
        if (!body || body.authorize !== true) {
          sendJson(response, 400, {
            status: 'authorization-required',
            message: '启用项目需要你明确确认。',
          })
          return
        }
        // Browser-provided filesystem paths are intentionally ignored. The
        // server can mutate only the project selected before startup.
        const result = await enableAaop({ projectRoot, authorized: true })
        if (result.status === 'failed') {
          sendJson(response, 409, {
            status: 'setup-failed',
            message: result.reason,
            retryable: true,
          })
          return
        }
        sendJson(response, 200, {
          status: result.status,
          project: projectOnboardingSnapshot(result.onboarding),
          aaopVersion: result.onboarding.aaopVersion,
        })
        return
      }

      if (method === 'POST' && url.pathname === '/api/intake') {
        let parsed: unknown
        try {
          parsed = await readJsonBody(request)
        } catch (error) {
          const code = error instanceof Error ? error.message : ''
          sendJson(response, code === 'request-body-too-large' ? 413 : 400, {
            status: 'bad-request',
            message: code === 'request-body-too-large'
              ? '你的描述太长了，请先保留最重要的部分。'
              : 'Workbench 无法读取这次请求。',
          })
          return
        }
        const body = objectBody(parsed)
        const rawRequest = typeof body?.request === 'string' ? body.request.trim() : ''
        if (!rawRequest) {
          sendJson(response, 400, {
            status: 'bad-request',
            message: '先告诉我你现在想完成什么。',
          })
          return
        }
        if (rawRequest.length > MAX_REQUEST_TEXT_CHARS) {
          sendJson(response, 413, {
            status: 'bad-request',
            message: '你的描述太长了，请先保留最重要的部分。',
          })
          return
        }

        let result: DevelopmentIntakeApplicationResult
        try {
          result = await runIntake({
            rawRequest,
            projectRoot,
            trustedProject: true,
            workbenchRoot,
            harnessCheckout,
            provider: options.provider,
            model: options.model,
            sessionRoot: options.sessionRoot,
          })
        } catch (error) {
          logError(error)
          sendJson(response, 503, intakeUnavailable(rawRequest))
          return
        }
        sendJson(response, 200, result)
        return
      }

      if (method === 'GET' && url.pathname === '/api/provider/secret') {
        sendJson(response, 200, { hasSecret: Boolean(options.providerSecret) })
        return
      }

      if (method === 'POST' && url.pathname === '/api/provider/secret') {
        let parsed: unknown
        try {
          parsed = await readJsonBody(request)
        } catch (error) {
          const code = error instanceof Error ? error.message : ''
          sendJson(response, code === 'request-body-too-large' ? 413 : 400, {
            status: 'bad-request',
            message: 'Workbench 无法读取这个密钥。',
          })
          return
        }
        const body = objectBody(parsed)
        const secret = typeof body?.secret === 'string' ? body.secret.trim() : ''
        if (!secret) {
          sendJson(response, 400, {
            status: 'bad-request',
            message: '请输入有效的 API Key。',
          })
          return
        }
        if (secret.length > 10_000) {
          sendJson(response, 413, {
            status: 'bad-request',
            message: '密钥内容过长。',
          })
          return
        }
        options.providerSecret = secret
        sendJson(response, 200, { hasSecret: true })
        return
      }

      // Phase 4: bounded execution API (requires valid grant + provider secret).
      if (method === 'POST' && url.pathname === '/api/execute') {
        let parsed: unknown
        try {
          parsed = await readJsonBody(request)
        } catch (error) {
          const code = error instanceof Error ? error.message : ''
          sendJson(response, code === 'request-body-too-large' ? 413 : 400, {
            status: 'bad-request',
            message: 'Workbench 无法读取这次执行请求。',
          })
          return
        }
        const body = objectBody(parsed)
        const grant = typeof body?.grant === 'object' && body.grant !== null ? body.grant : null
        const binding = typeof body?.binding === 'object' && body.binding !== null ? body.binding : null

        if (!grant || !binding) {
          sendJson(response, 400, {
            status: 'bad-request',
            message: '执行需要有效的 Provider Execution Grant 和 Workbench Binding。',
          })
          return
        }

        // Provider secret must be configured for execution.
        if (!options.providerSecret) {
          sendJson(response, 402, {
            status: 'provider-required',
            message: '执行需要模型服务密钥。请先在下方配置 API Key。',
          })
          return
        }

        let executionResult: BoundedExecutionResult
        try {
          // Type-safe extraction from parsed JSON body.
          const typedGrant = grant as {
            schema_version: string
            grant_id: string
            provider: string
            route: string
            working_contract_revision: number
            goal: string
            baseline: string[]
            execution_mode: string
            task_pod: unknown
            tasks: { id: string; action: string; failure_path: string }[]
            authorization: {
              mutation_boundary: string
              write_target: { repository: string; base_ref: string; working_ref: string; environment?: string | null } | null
              allowed_effects: string[]
              protected_effects: string[]
            }
            acceptance_evidence: string[]
            human_open_questions: string[]
            references: string[]
            issued_at: string
          }
          const typedBinding = binding as { workUnitId: string; grantId: string }
          const executionOptions: BoundedExecutionOptions = {
            workUnit: {
              id: typedBinding.workUnitId,
              spaceId: 'SPACE-unknown',
              title: 'Execution Work Unit',
              outcome: typedGrant.goal,
              state: 'ready',
              owner: 'development-aaop',
              gate: { kind: 'none', open: false },
              acceptance: [],
              evidence: [],
              assets: [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            } as any,
            grant: typedGrant as any,
            binding: typedBinding as any,
            projectRoot,
            harnessCheckout,
            workbenchRoot,
            provider: options.provider,
            model: options.model,
            sessionRoot: options.sessionRoot,
          }
          validateExecutionPreconditions(executionOptions)
          executionResult = await runBoundedExecution(executionOptions)
        } catch (error) {
          logError(error)
          sendJson(response, 502, {
            status: 'execution-failed',
            message: error instanceof Error ? error.message : '执行过程中发生未知错误。',
            retryable: false,
          })
          return
        }

        sendJson(response, 200, {
          status: 'executed',
          workUnit: {
            id: executionResult.workUnit.id,
            state: executionResult.workUnit.state,
            evidence: executionResult.workUnit.evidence,
            nextFrontier: executionResult.workUnit.nextFrontier,
          },
          sessionId: executionResult.sessionId,
          stopReason: executionResult.stopReason,
          assistantText: executionResult.assistantText,
          frontierDecision: executionResult.frontierDecision,
          repositoryReadback: executionResult.repositoryReadback,
        })
        return
      }

      // Stage B intentionally has no execution/mutation API beyond the explicit
      // AAOP setup lifecycle action above.
      sendJson(response, 404, { status: 'not-found' })
    } catch (error) {
      logError(error)
      if (!response.headersSent) {
        sendJson(response, 500, {
          status: 'internal-error',
          message: 'Workbench 当前无法完成这次本地请求。',
        })
      } else {
        response.end()
      }
    }
  })

  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(options.port ?? 0, LOOPBACK_HOST, () => {
      server.off('error', reject)
      resolvePromise()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server)
    throw new Error('Workbench local server did not bind a TCP port')
  }
  boundPort = address.port

  return {
    url: `http://${LOOPBACK_HOST}:${boundPort}`,
    port: boundPort,
    requestToken,
    close: () => closeServer(server),
  }
}
