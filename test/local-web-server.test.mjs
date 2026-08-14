import test from 'node:test'
import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { resolve } from 'node:path'

import { startLocalWorkbenchServer } from '../.tmp/index.js'

function projectIdentity() {
  return {
    id: 'local-fixture-123456789abc',
    title: 'Fixture Project',
    root: '/workspace/fixture',
    domainPackId: 'development-aaop',
  }
}

function readyOnboarding() {
  return {
    status: 'ready',
    project: projectIdentity(),
    source: 'installed-aaop',
    aaopVersion: '1.2.0',
    pythonCommand: 'python3',
    manifest: {
      schema_version: '1.0',
      project: {
        id: 'local-fixture-123456789abc',
        title: 'Fixture Project',
        domain_pack: 'development-aaop',
      },
      development: {
        aaop_bridge: {
          ready: { command: 'python3', args: ['.aaop/tools/aaop.py', 'ready', '.'] },
          status: { command: 'python3', args: ['.aaop/tools/aaop.py', 'status', '.'] },
          prompt: { command: 'python3', args: ['.aaop/tools/aaop.py', 'prompt'] },
        },
      },
    },
  }
}

function setupRequired() {
  return {
    status: 'setup-required',
    project: projectIdentity(),
    reason: 'AAOP is not installed.',
  }
}

function readyIntakeResult(rawRequest = '看看这个项目下一步该做什么') {
  return {
    status: 'ready',
    space: {
      id: 'SPACE-local-fixture-123456789abc',
      title: 'Fixture Project',
      projectId: 'local-fixture-123456789abc',
      projectRoot: '/workspace/fixture',
      domainPackId: 'development-aaop',
    },
    workUnit: {
      id: 'WU-fixture',
      title: rawRequest,
      outcome: rawRequest,
      state: 'ready',
      gate: { kind: 'none', open: false },
      evidence: [
        {
          kind: 'session',
          summary: '已完成只读项目理解。',
          observedAt: '2026-08-14T06:00:00.000Z',
          authoritative: false,
        },
      ],
      nextFrontier: 'Review the current project frontier.',
    },
    intake: {
      situation: 'existing_repository',
      route: 'understand-review',
      routeConfidence: 0.9,
      ambiguities: [],
      questionNeeded: null,
      projectEvidenceSummary: ['Repository inspected read-only.'],
      nextAction: 'Review the current project frontier.',
    },
  }
}

async function withServer(dependencies, fn) {
  const handle = await startLocalWorkbenchServer(
    {
      projectRoot: '/workspace/fixture',
      workbenchRoot: '/workbench',
      harnessCheckout: '/harness',
      port: 0,
    },
    dependencies,
  )
  try {
    await fn(handle)
  } finally {
    await handle.close()
  }
}

function apiHeaders(handle, extra = {}) {
  return {
    'x-ming-workbench-token': handle.requestToken,
    ...extra,
  }
}

async function rawRequest({ port, path = '/', method = 'GET', headers = {}, body = '' }) {
  return new Promise((resolvePromise, reject) => {
    const request = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers,
      },
      (response) => {
        const chunks = []
        response.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
        response.on('end', () => {
          resolvePromise({
            statusCode: response.statusCode,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: response.headers,
          })
        })
      },
    )
    request.on('error', reject)
    if (body) request.write(body)
    request.end()
  })
}

test('local Workbench binds only to loopback and normal HTML hides Harness implementation concepts', async () => {
  await withServer(
    { resolveOnboarding: () => readyOnboarding() },
    async (handle) => {
      assert.match(handle.url, /^http:\/\/127\.0\.0\.1:\d+$/)
      const response = await fetch(handle.url)
      assert.equal(response.status, 200)
      const html = await response.text()
      assert.match(html, /Ming Workbench/)
      assert.match(html, /把一句想法，变成看得见的工作/)
      assert.doesNotMatch(html, /DeepSeek Harness/i)
      assert.doesNotMatch(html, /\bACP\b/)
      assert.doesNotMatch(html, /\bPTC\b/)
      assert.doesNotMatch(html, /startup plugin/i)
      assert.equal(response.headers.get('access-control-allow-origin'), null)
      assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/)
    },
  )
})

test('all API routes require the per-process local request token', async () => {
  await withServer(
    { resolveOnboarding: () => readyOnboarding() },
    async (handle) => {
      const response = await fetch(`${handle.url}/api/project`)
      assert.equal(response.status, 403)
      const body = await response.json()
      assert.equal(body.status, 'forbidden')
    },
  )
})

test('authorized API token returns only a human-facing project snapshot', async () => {
  await withServer(
    { resolveOnboarding: () => readyOnboarding() },
    async (handle) => {
      const response = await fetch(`${handle.url}/api/project`, {
        headers: apiHeaders(handle),
      })
      assert.equal(response.status, 200)
      const body = await response.json()
      assert.deepEqual(body, {
        status: 'ready',
        project: {
          id: 'local-fixture-123456789abc',
          title: 'Fixture Project',
        },
        aaopVersion: '1.2.0',
        message: '项目已准备，可以先做只读理解。',
      })
      assert.equal('root' in body.project, false)
      assert.equal('manifest' in body, false)
    },
  )
})

test('setup cannot run without token and browser-supplied projectRoot cannot change the fixed target', async () => {
  let calls = 0
  let observed
  await withServer(
    {
      resolveOnboarding: () => setupRequired(),
      enableAaop: async (options) => {
        calls += 1
        observed = options
        return { status: 'installed', onboarding: readyOnboarding(), sourceRevision: 'a'.repeat(40), aaopVersion: '1.2.0' }
      },
    },
    async (handle) => {
      const denied = await fetch(`${handle.url}/api/setup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ authorize: true }),
      })
      assert.equal(denied.status, 403)
      assert.equal(calls, 0)

      const allowed = await fetch(`${handle.url}/api/setup`, {
        method: 'POST',
        headers: apiHeaders(handle, { 'content-type': 'application/json' }),
        body: JSON.stringify({ authorize: true, projectRoot: '/evil/outside/project' }),
      })
      assert.equal(allowed.status, 200)
      assert.equal(calls, 1)
      assert.deepEqual(observed, {
        projectRoot: resolve('/workspace/fixture'),
        authorized: true,
      })
    },
  )
})

test('read-only Intake always uses the server-fixed project and trusted project boundary', async () => {
  let observed
  const requestText = '看看这个项目下一步最应该做什么？'
  await withServer(
    {
      resolveOnboarding: () => readyOnboarding(),
      runIntake: async (options) => {
        observed = options
        return readyIntakeResult(options.rawRequest)
      },
    },
    async (handle) => {
      const response = await fetch(`${handle.url}/api/intake`, {
        method: 'POST',
        headers: apiHeaders(handle, { 'content-type': 'application/json' }),
        body: JSON.stringify({ request: requestText, projectRoot: '/evil' }),
      })
      assert.equal(response.status, 200)
      const body = await response.json()
      assert.equal(body.status, 'ready')
      assert.equal(observed.projectRoot, resolve('/workspace/fixture'))
      assert.equal(observed.trustedProject, true)
      assert.equal(observed.rawRequest, requestText)
      assert.equal(observed.workbenchRoot, resolve('/workbench'))
      assert.equal(observed.harnessCheckout, resolve('/harness'))
    },
  )
})

test('Intake/provider outage returns recoverable 503, preserves the request, and does not fake a Work Unit result', async () => {
  const requestText = '继续看看这个项目，不要丢掉我这句话。'
  const technicalErrors = []
  await withServer(
    {
      resolveOnboarding: () => readyOnboarding(),
      runIntake: async () => {
        throw new Error('SECRET_PROVIDER_STACK model backend exploded')
      },
      logError: (error) => technicalErrors.push(error),
    },
    async (handle) => {
      const response = await fetch(`${handle.url}/api/intake`, {
        method: 'POST',
        headers: apiHeaders(handle, { 'content-type': 'application/json' }),
        body: JSON.stringify({ request: requestText }),
      })
      assert.equal(response.status, 503)
      const body = await response.json()
      assert.equal(body.status, 'intake-unavailable')
      assert.equal(body.request, requestText)
      assert.equal(body.retryable, true)
      assert.equal('workUnit' in body, false)
      assert.equal(JSON.stringify(body).includes('SECRET_PROVIDER_STACK'), false)
      assert.equal(technicalErrors.length, 1)
    },
  )
})

test('Stage B exposes no execution endpoint', async () => {
  await withServer(
    { resolveOnboarding: () => readyOnboarding() },
    async (handle) => {
      const response = await fetch(`${handle.url}/api/execute`, {
        method: 'POST',
        headers: apiHeaders(handle, { 'content-type': 'application/json' }),
        body: '{}',
      })
      assert.equal(response.status, 404)
    },
  )
})

test('unexpected Host header is rejected before any API logic', async () => {
  let onboardingCalls = 0
  await withServer(
    { resolveOnboarding: () => { onboardingCalls += 1; return readyOnboarding() } },
    async (handle) => {
      const response = await rawRequest({
        port: handle.port,
        path: '/api/project',
        headers: {
          host: `evil.example:${handle.port}`,
          'x-ming-workbench-token': handle.requestToken,
        },
      })
      assert.equal(response.statusCode, 400)
      assert.equal(onboardingCalls, 0)
    },
  )
})

test('cross-origin mutation request is rejected even with the local token', async () => {
  let setupCalls = 0
  await withServer(
    {
      resolveOnboarding: () => setupRequired(),
      enableAaop: async () => {
        setupCalls += 1
        return { status: 'installed', onboarding: readyOnboarding(), sourceRevision: 'a'.repeat(40), aaopVersion: '1.2.0' }
      },
    },
    async (handle) => {
      const response = await fetch(`${handle.url}/api/setup`, {
        method: 'POST',
        headers: apiHeaders(handle, {
          'content-type': 'application/json',
          origin: 'https://evil.example',
        }),
        body: JSON.stringify({ authorize: true }),
      })
      assert.equal(response.status, 403)
      assert.equal(setupCalls, 0)
    },
  )
})

test('oversized local API body is rejected before Intake execution', async () => {
  let intakeCalls = 0
  await withServer(
    {
      resolveOnboarding: () => readyOnboarding(),
      runIntake: async () => {
        intakeCalls += 1
        return readyIntakeResult()
      },
    },
    async (handle) => {
      const body = JSON.stringify({ request: 'x'.repeat(70 * 1024) })
      const response = await fetch(`${handle.url}/api/intake`, {
        method: 'POST',
        headers: apiHeaders(handle, { 'content-type': 'application/json' }),
        body,
      })
      assert.equal(response.status, 413)
      assert.equal(intakeCalls, 0)
    },
  )
})
