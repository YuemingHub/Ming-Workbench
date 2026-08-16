import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
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
  type BoundedExecutionResult,
  type BoundedExecutionOptions,
} from '../execution/bounded-execution.js'
import type { ProviderExecutionGrant } from '../execution/provider-grant.js'
import { issueProviderExecutionGrant } from '../execution/grant-issuance.js'
import { readRepositorySnapshot } from '../execution/repository.js'
import {
  buildExactSlice,
  buildUnknownSlice,
  buildWholeRepositorySlice,
  sliceScopeLabel,
  type MutationSlice,
} from '../execution/mutation-slice.js'
import {
  proposeMutationScope,
  type ProposedMutation,
} from '../execution/scope-proposal.js'
import {
  fromPersistedWorkUnit,
  noopWorkUnitStore,
  toPersistedWorkUnit,
  type MutableFacts,
  type WorkUnitStoreApi,
} from '../persistence/work-unit-store.js'
import { createFileWorkUnitStore } from '../persistence/file-work-unit-store.js'
import type { WorkUnit } from '../core/model.js'
import {
  runHarnessProviderProbe,
  type HarnessProviderProbeOptions,
} from '../transports/harness-acp.js'
import { sanitizeDiagnosticText } from '../hosts/harness-runtime.js'

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
  /** Directory for the JSON Work Unit store (userData in desktop mode). */
  storeDir?: string
  /** Optional explicit project test command for execution evidence. */
  testCommand?: string[]
}

export interface LocalWorkbenchServerDependencies {
  resolveOnboarding?: (projectRoot: string) => ProjectOnboardingResult
  enableAaop?: (
    options: { projectRoot: string; authorized: boolean },
  ) => Promise<EnableProjectAaopResult>
  runIntake?: typeof runDevelopmentIntakeApplication
  runProviderProbe?: (options: HarnessProviderProbeOptions) => Promise<unknown>
  logError?: (error: unknown) => void
  /** Work Unit store. Defaults to a file store at storeDir, or no-op. */
  store?: WorkUnitStoreApi
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
  const store = dependencies.store
    ?? (options.storeDir ? createFileWorkUnitStore(options.storeDir) : noopWorkUnitStore)
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
        sendJson(response, 200, {
          ...projectOnboardingSnapshot(resolveOnboarding(projectRoot)),
          projectPath: projectRoot,
        })
        return
      }

      // Resume: expose the authoritative persisted Work Units for this project.
      // No secret, no grant internals beyond existence, are returned.
      if (method === 'GET' && url.pathname === '/api/workunits') {
        const loaded = store.load()
        sendJson(response, 200, {
          status: 'ok',
          projectRoot: loaded.projectRoot,
          workUnits: loaded.workUnits.map((w) => ({
            id: w.id,
            title: w.title,
            outcome: w.outcome,
            state: w.state,
            gate: w.gate,
            evidenceCount: w.evidence.length,
            nextFrontier: w.nextFrontier,
            updatedAt: w.updatedAt,
          })),
          hasStoredGrant: Object.keys(loaded.grants).length > 0,
        })
        return
      }

      // Resume: re-read mutable facts for a persisted Work Unit and return
      // reconciliation status. The caller must re-authorize if facts changed.
      if (method === 'POST' && url.pathname === '/api/resume') {
        let parsed: unknown
        try {
          parsed = await readJsonBody(request)
        } catch (error) {
          const code = error instanceof Error ? error.message : ''
          sendJson(response, code === 'request-body-too-large' ? 413 : 400, {
            status: 'bad-request',
            message: 'Workbench 无法读取这次恢复请求。',
          })
          return
        }
        const body = objectBody(parsed)
        const workUnitId = typeof body?.workUnitId === 'string' ? body.workUnitId : ''
        if (!workUnitId) {
          sendJson(response, 400, {
            status: 'bad-request',
            message: '恢复需要指明要恢复的 Work Unit。',
          })
          return
        }
        const loaded = store.load()
        const record = loaded.workUnits.find((w) => w.id === workUnitId)
        if (!record) {
          sendJson(response, 404, {
            status: 'not-found',
            message: '找不到这个 Work Unit。',
          })
          return
        }
        // Re-read live mutable facts.
        const currentFacts = readMutableFacts(projectRoot, options)
        const storedFacts = loaded.lastMutableFacts
        const factsChanged = !storedFacts || mutableFactsChanged(storedFacts, currentFacts)
        sendJson(response, 200, {
          status: 'ok',
          workUnit: {
            id: record.id,
            title: record.title,
            outcome: record.outcome,
            state: record.state,
            gate: record.gate,
            evidenceCount: record.evidence.length,
            nextFrontier: record.nextFrontier,
            updatedAt: record.updatedAt,
          },
          factsChanged,
          currentFacts,
          proposedMutation: deriveProposedMutationFromRecord(projectRoot, record),
        })
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
        sendJson(response, 200, {
          ...result,
          proposedMutation: deriveProposedMutation(projectRoot, result),
        })

        // Persist the authoritative Work Unit so the product survives close/reopen.
        try {
          const now = new Date().toISOString()
          const fullUnit: WorkUnit = {
            id: result.workUnit.id,
            spaceId: result.space.id,
            title: result.workUnit.title,
            outcome: result.workUnit.outcome,
            state: result.workUnit.state,
            owner: 'development-aaop',
            gate: result.workUnit.gate,
            acceptance: [],
            evidence: result.workUnit.evidence.map((e, index) => ({
              id: `EV-${result.workUnit.id}-${index}`,
              kind: e.kind,
              summary: e.summary,
              observedAt: e.observedAt,
              authoritative: e.authoritative,
            })),
            assets: [],
            nextFrontier: result.workUnit.nextFrontier,
            createdAt: now,
            updatedAt: now,
          }
          const loaded = store.load()
          const existing = loaded.workUnits.find((w) => w.id === fullUnit.id)
          const next = existing
            ? loaded.workUnits.map((w) => (w.id === fullUnit.id ? toPersistedWorkUnit(fullUnit) : w))
            : [...loaded.workUnits, toPersistedWorkUnit(fullUnit)]
          store.save({ ...loaded, projectRoot, workUnits: next, lastProjectRoot: projectRoot })
        } catch (error) {
          logError(error)
        }
        return
      }

      // Phase 4: bounded execution requires an explicit human-authorized grant.
      // The browser may request execution of a Work Unit, but it can never
      // fabricate the Work Unit, grant, Gate, or mutation boundary.
      if (method === 'POST' && url.pathname === '/api/authorize') {
        let parsed: unknown
        try {
          parsed = await readJsonBody(request)
        } catch (error) {
          const code = error instanceof Error ? error.message : ''
          sendJson(response, code === 'request-body-too-large' ? 413 : 400, {
            status: 'bad-request',
            message: 'Workbench 无法读取这次授权请求。',
          })
          return
        }
        const body = objectBody(parsed)
        const workUnitId = typeof body?.workUnitId === 'string' ? body.workUnitId : ''
        if (body?.authorize !== true || !workUnitId) {
          sendJson(response, 400, {
            status: 'authorization-required',
            message: '执行需要你明确授权这次受边界约束的改动。',
          })
          return
        }
        const loaded = store.load()
        const record = loaded.workUnits.find((w) => w.id === workUnitId)
        if (!record) {
          sendJson(response, 404, {
            status: 'not-found',
            message: '找不到这个 Work Unit，可能还没有通过理解生成。',
          })
          return
        }
        const snapshot = readRepositorySnapshot(projectRoot)

        // P0-1: the exact mutation boundary must come from the human-confirmed
        // file surface. There is deliberately NO default: unknown surface
        // refuses write authorization (read-only intake stays allowed).
        let slice: MutationSlice
        const filePaths = body?.filePaths
        const wholeRepository = body?.wholeRepository === true
        if (Array.isArray(filePaths)) {
          if (filePaths.some((p) => typeof p !== 'string')) {
            sendJson(response, 400, {
              status: 'invalid-surface',
              message: '受影响的文件必须是文件路径列表。',
            })
            return
          }
          try {
            slice = buildExactSlice(projectRoot, snapshot.head || 'HEAD', filePaths as string[])
          } catch (error) {
            sendJson(response, 400, {
              status: 'invalid-surface',
              message: error instanceof Error ? error.message : '无法确定这次改动的文件范围。',
            })
            return
          }
        } else if (wholeRepository) {
          slice = buildWholeRepositorySlice(projectRoot, snapshot.head || 'HEAD')
        } else {
          sendJson(response, 400, {
            status: 'scope-required',
            message: '还不清楚这次改动会影响哪些文件，不能生成写授权。请确认受影响的文件，或明确选择“整个仓库”后重新授权。',
          })
          return
        }

        const { grant, binding } = issueProviderExecutionGrant({
          workUnit: fromPersistedWorkUnit(record),
          projectRoot,
          snapshot,
          slice,
        })
        const nextGrants = {
          ...loaded.grants,
          // The frozen slice is persisted with the grant so a later
          // /api/execute can prove the frontier overlap and the post-execution
          // delta without re-deriving it from a browser payload.
          [grant.grant_id]: {
            grant: grant as unknown as Record<string, unknown>,
            binding,
            slice: {
              repository: slice.repository,
              baseRef: slice.baseRef,
              scope: slice.scope,
            },
          },
        }
        const currentFacts = readMutableFacts(projectRoot, options)
        store.save({
          ...loaded,
          projectRoot,
          grants: nextGrants,
          lastProjectRoot: projectRoot,
          lastMutableFacts: currentFacts,
        })
        sendJson(response, 200, {
          status: 'authorized',
          workUnitId,
          grantId: grant.grant_id,
          slice: {
            repository: slice.repository,
            baseRef: slice.baseRef,
            scopeLabel: sliceScopeLabel(slice),
            paths: slice.scope.kind === 'exact' ? slice.scope.paths : [],
          },
          writeTarget: grant.authorization.write_target,
          allowedEffects: grant.authorization.allowed_effects,
          protectedEffects: grant.authorization.protected_effects,
          message: '已生成受边界约束的执行授权，接下来可以执行。',
        })
        return
      }

      // Phase 4: bounded execution API.
      // The browser may only ask to execute an existing Work Unit. The grant and
      // Work Unit are resolved from the authoritative backend store, never from
      // browser-supplied JSON.
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
        const workUnitId = typeof body?.workUnitId === 'string' && body.workUnitId.length > 0
          ? body.workUnitId
          : null

        if (!workUnitId) {
          sendJson(response, 400, {
            status: 'bad-request',
            message: '执行需要指明要执行的 Work Unit。',
          })
          return
        }

        // Provider secret must be configured for execution. Desktop mode injects
        // it via Electron safeStorage into the backend child env; web mode uses the
        // DEEPSEEK_API_KEY environment. It is never read from the request body.
        const providerSecret = process.env.DEEPSEEK_API_KEY
        if (!providerSecret) {
          sendJson(response, 402, {
            status: 'provider-required',
            message: '执行需要模型服务密钥。请在 Electron 桌面模式中配置，或设置 DEEPSEEK_API_KEY 环境变量。',
          })
          return
        }

        let executionResult: BoundedExecutionResult
        try {
          const loaded = store.load()
          const record = loaded.workUnits.find((w) => w.id === workUnitId)
          if (!record) {
            sendJson(response, 404, {
              status: 'not-found',
              message: `Work Unit ${workUnitId} 不存在于后端存储，无法执行。`,
            })
            return
          }
          // The most recently issued grant wins: a re-authorization after stale
          // facts must supersede the older grant for the same Work Unit.
          const grantEntries = Object.values(loaded.grants).filter(
            (g) => g.binding.workUnitId === workUnitId,
          )
          const grantEntry = grantEntries[grantEntries.length - 1]
          if (!grantEntry) {
            sendJson(response, 400, {
              status: 'authorization-required',
              message: `Work Unit ${workUnitId} 还没有经过你授权的执行授权。`,
            })
            return
          }
          const workUnit = fromPersistedWorkUnit(record)
          const grant = grantEntry.grant as unknown as ProviderExecutionGrant
          const binding = grantEntry.binding
          // P0-1: the frozen slice is the only authorized surface. Legacy
          // stores recorded `intendedFiles: [projectRoot]` as a disguised
          // whole-repository scope; migrate it to an explicit whole-repository
          // slice so no execution runs under a fake per-file boundary.
          const slice = resolveGrantSlice(grantEntry, projectRoot)

          // Re-check mutable facts: stale authority must not be reused.
          const currentFacts = readMutableFacts(projectRoot, options)
          const storedFacts = loaded.lastMutableFacts
          if (storedFacts && mutableFactsChanged(storedFacts, currentFacts)) {
            sendJson(response, 409, {
              status: 'stale-authority',
              message: '项目情况已发生变化，旧的执行授权不能直接复用。请重新授权。',
              factsChanged: true,
              currentFacts,
            })
            return
          }

          const executionOptions: BoundedExecutionOptions = {
            workUnit,
            grant,
            binding,
            slice,
            projectRoot,
            harnessCheckout,
            workbenchRoot,
            provider: options.provider,
            model: options.model,
            sessionRoot: options.sessionRoot,
            testCommand: options.testCommand,
            // P0-C write boundary: default-off safety rail. Normal UI keeps execution
            // disabled unless an operator explicitly enables write mutation.
            allowWrite: process.env.MING_WORKBENCH_ALLOW_WRITE === '1',
          }
          // B2: persist the 'running' state BEFORE execution starts so the
          // authoritative Work Unit store reflects active execution.  The
          // desktop main process reads this store to gate updates.
          const runningUnits = loaded.workUnits.map((w) =>
            w.id === workUnit.id
              ? { ...w, state: 'running', updatedAt: new Date().toISOString() }
              : w,
          )
          store.save({ ...loaded, projectRoot, workUnits: runningUnits, lastProjectRoot: projectRoot })

          executionResult = await runBoundedExecution(executionOptions)

          // Persist the evidence-backed Work Unit update so resume survives close.
          const updated = loaded.workUnits.map((w) =>
            w.id === executionResult.workUnit.id
              ? toPersistedWorkUnit(executionResult.workUnit)
              : w,
          )
          store.save({ ...loaded, projectRoot, workUnits: updated, lastProjectRoot: projectRoot })
        } catch (error) {
          logError(error)
          // B2: restore an evidence-honest non-running state so the desktop
          // updater gate never sees a stale 'running' after a failed execution.
          // Reusing the existing 'blocked' WorkUnitState; the failure reason is
          // preserved in nextFrontier so the user can see this attempt did not
          // complete.
          try {
            const failedStore = store.load()
            const failureMessage = error instanceof Error ? error.message : '执行过程中发生未知错误。'
            const restored = failedStore.workUnits.map((w) =>
              w.id === workUnitId && w.state === 'running'
                ? {
                    ...w,
                    state: 'blocked',
                    nextFrontier: `执行未完成：${failureMessage}`,
                    updatedAt: new Date().toISOString(),
                  }
                : w,
            )
            store.save({ ...failedStore, projectRoot, workUnits: restored, lastProjectRoot: projectRoot })
          } catch (persistError) {
            logError(persistError)
          }
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
            gate: executionResult.workUnit.gate,
            evidence: executionResult.workUnit.evidence,
            nextFrontier: executionResult.workUnit.nextFrontier,
          },
          sessionId: executionResult.sessionId,
          stopReason: executionResult.stopReason,
          assistantText: executionResult.assistantText,
          frontierDecision: executionResult.frontierDecision,
          repositoryReadback: executionResult.repositoryReadback,
          runOutcome: executionResult.runOutcome,
        })
        return
      }

      // Provider connectivity: a REAL round trip through the reviewed Harness
      // (one minimal read-only ACP session), never just "an API key string
      // exists". Failures are human-readable and sanitized — the API key,
      // auth headers and secret-bearing URLs never reach the response.
      if (method === 'POST' && url.pathname === '/api/test-provider-connection') {
        if (!process.env.DEEPSEEK_API_KEY) {
          sendJson(response, 402, {
            status: 'provider-required',
            message: '还没有配置模型服务密钥。请先在「配置 AI」里保存 API Key。',
          })
          return
        }
        const probe = dependencies.runProviderProbe ?? runHarnessProviderProbe
        try {
          const result = await probe({
            harnessCheckout,
            workbenchRoot,
            provider: options.provider,
            model: options.model,
            sessionRoot: options.sessionRoot,
            shutdownGraceMs: 90_000,
          })
          sendJson(response, 200, {
            ok: true,
            provider: options.provider ?? 'deepseek-official',
            model: options.model ?? 'deepseek-v4-pro',
            sessionId: (result as { sessionId?: string })?.sessionId ?? null,
          })
        } catch (error) {
          const raw = error instanceof Error ? error.message : String(error)
          sendJson(response, 200, {
            ok: false,
            message: sanitizeDiagnosticText(raw),
          })
        }
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

function readMutableFacts(projectRoot: string, options: LocalWorkbenchServerOptions): MutableFacts {
  const gitHead = tryGitHead(projectRoot)
  const gitBranch = tryGitBranch(projectRoot)
  const gitDirty = tryGitDirty(projectRoot)
  return {
    projectId: resolve(projectRoot),
    gitHead,
    gitBranch,
    gitDirty,
    providerAvailable: Boolean(options.provider || process.env.DEEPSEEK_API_KEY),
    harnessAvailable: Boolean(options.harnessCheckout && existsSync(options.harnessCheckout)),
  }
}

function tryGitHead(cwd: string): string {
  try {
    return execFileSync('git', ['-C', cwd, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return ''
  }
}

function tryGitBranch(cwd: string): string {
  try {
    return execFileSync('git', ['-C', cwd, 'branch', '--show-current'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  } catch {
    return ''
  }
}

function tryGitDirty(cwd: string): boolean {
  try {
    const out = execFileSync('git', ['-C', cwd, 'status', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    return out.length > 0
  } catch {
    return false
  }
}

function mutableFactsChanged(a: MutableFacts, b: MutableFacts): boolean {
  return (
    a.projectId !== b.projectId ||
    a.gitHead !== b.gitHead ||
    a.gitBranch !== b.gitBranch ||
    a.gitDirty !== b.gitDirty ||
    a.providerAvailable !== b.providerAvailable ||
    a.harnessAvailable !== b.harnessAvailable
  )
}

/**
 * B3: Derive a proposed mutation scope from a persisted Work Unit record
 * (for the resume flow). Uses the Work Unit title and nextFrontier as
 * context for keyword extraction.
 */
function deriveProposedMutationFromRecord(
  projectRoot: string,
  record: { title: string; outcome: string; nextFrontier?: string },
): ProposedMutation | undefined {
  return proposeMutationScope({
    projectRoot,
    rawRequest: record.title,
    intakeEvidence: record.nextFrontier ? [record.nextFrontier] : [],
    nextAction: record.nextFrontier ?? '',
    route: '',
  })
}

/**
 * B3: Derive a non-authoritative proposed mutation scope from the read-only
 * intake result. This is a Workbench product-owned suggestion — not AAOP Core,
 * not Provider Execution Grant. The real authority is the frozen MutationSlice
 * created by buildExactSlice after human approval.
 */
function deriveProposedMutation(
  projectRoot: string,
  result: DevelopmentIntakeApplicationResult,
): ProposedMutation | undefined {
  if (result.status !== 'ready' && result.status !== 'needs-human') return undefined
  if (!result.intake) return undefined

  return proposeMutationScope({
    projectRoot,
    rawRequest: result.workUnit.title,
    intakeEvidence: result.intake.projectEvidenceSummary,
    nextAction: result.intake.nextAction,
    route: result.intake.route,
  })
}

/**
 * Resolve the frozen MutationSlice from a persisted grant. New stores carry
 * the explicit slice; legacy stores carried `intendedFiles` (where
 * `[projectRoot]` was the old disguised whole-repository default). Migration
 * is explicit: a single projectRoot entry becomes an explicit
 * whole-repository slice, anything else becomes an exact slice. Fail-closed
 * when neither is present.
 */
function resolveGrantSlice(
  grantEntry: {
    slice?: { repository: string; baseRef: string; scope: { kind: string; paths?: string[] } }
    intendedFiles?: string[]
  },
  projectRoot: string,
): MutationSlice {
  if (grantEntry.slice) {
    const scope = grantEntry.slice.scope
    return {
      repository: grantEntry.slice.repository,
      baseRef: grantEntry.slice.baseRef,
      scope:
        scope.kind === 'exact'
          ? { kind: 'exact', paths: scope.paths ?? [] }
          : scope.kind === 'whole-repository'
            ? { kind: 'whole-repository' }
            : { kind: 'unknown' },
    }
  }
  const legacy = grantEntry.intendedFiles
  if (Array.isArray(legacy) && legacy.length > 0) {
    const projectRootPath = resolve(projectRoot)
    if (legacy.length === 1 && resolve(legacy[0]) === projectRootPath) {
      // Old disguised whole-repository default -> explicit whole-repository.
      return buildWholeRepositorySlice(projectRoot, '')
    }
    return buildExactSlice(projectRoot, '', legacy)
  }
  return buildUnknownSlice(projectRoot, '')
}
