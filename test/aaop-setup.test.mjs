import test from 'node:test'
import assert from 'node:assert/strict'

import {
  computeGitBlobSha,
  enableProjectAaop,
  resolvePromotedAaopStableSource,
} from '../.tmp/index.js'

const revision = 'a'.repeat(40)
const bootstrapBytes = Buffer.from("print('fixture bootstrap')\n", 'utf8')
const versionBytes = Buffer.from('1.2.0\n', 'utf8')

function jsonResponse(value, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return value
    },
  }
}

function contentResponse(bytes, sha = computeGitBlobSha(bytes)) {
  return {
    encoding: 'base64',
    content: Buffer.from(bytes).toString('base64'),
    sha,
  }
}

function projectIdentity() {
  return {
    id: 'local-fixture-123456789abc',
    title: 'Fixture Project',
    root: '/workspace/fixture',
    domainPackId: 'development-aaop',
  }
}

function setupRequired() {
  return {
    status: 'setup-required',
    project: projectIdentity(),
    reason: 'AAOP is not installed.',
  }
}

function ready(version = '1.2.0') {
  return {
    status: 'ready',
    project: projectIdentity(),
    source: 'installed-aaop',
    aaopVersion: version,
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

const stableSource = {
  revision,
  version: '1.2.0',
  bootstrapBytes,
  bootstrapBlobSha: computeGitBlobSha(bootstrapBytes),
  versionBlobSha: computeGitBlobSha(versionBytes),
}

test('stable source resolution pins bootstrap and VERSION to one exact revision and verifies Git blob identity', async () => {
  const requested = []
  const source = await resolvePromotedAaopStableSource(async (url) => {
    requested.push(url)
    if (url.endsWith('/git/ref/heads/stable')) {
      return jsonResponse({ object: { sha: revision } })
    }
    if (url.includes('/contents/scripts/bootstrap.py?ref=')) {
      return jsonResponse(contentResponse(bootstrapBytes))
    }
    if (url.includes('/contents/.aaop/VERSION?ref=')) {
      return jsonResponse(contentResponse(versionBytes))
    }
    return jsonResponse({}, 404)
  })

  assert.equal(source.revision, revision)
  assert.equal(source.version, '1.2.0')
  assert.equal(source.bootstrapBlobSha, computeGitBlobSha(bootstrapBytes))
  assert.equal(source.versionBlobSha, computeGitBlobSha(versionBytes))
  assert.equal(Buffer.from(source.bootstrapBytes).toString('utf8'), bootstrapBytes.toString('utf8'))
  assert.equal(requested.length, 3)
  assert.ok(requested[1].endsWith(`?ref=${revision}`))
  assert.ok(requested[2].endsWith(`?ref=${revision}`))
})

test('stable source resolution rejects connector bytes that do not match the Git object identity', async () => {
  await assert.rejects(
    resolvePromotedAaopStableSource(async (url) => {
      if (url.endsWith('/git/ref/heads/stable')) {
        return jsonResponse({ object: { sha: revision } })
      }
      if (url.includes('/contents/scripts/bootstrap.py?ref=')) {
        return jsonResponse(contentResponse(bootstrapBytes, 'b'.repeat(40)))
      }
      return jsonResponse(contentResponse(versionBytes))
    }),
    /Git blob identity mismatch/,
  )
})

test('setup requires explicit human authorization before any source or bootstrap work', async () => {
  let touched = false
  const result = await enableProjectAaop(
    { projectRoot: '/workspace/fixture', authorized: false },
    {
      targetIsDirectory: () => {
        touched = true
        return true
      },
    },
  )

  assert.equal(result.status, 'failed')
  assert.match(result.reason, /explicit human authorization/)
  assert.equal(touched, false)
})

test('already-ready project is not silently upgraded to a newer stable revision', async () => {
  let sourceResolved = false
  let bootstrapRan = false
  const result = await enableProjectAaop(
    { projectRoot: '/workspace/fixture', authorized: true },
    {
      targetIsDirectory: () => true,
      resolveOnboarding: () => ready('1.1.0'),
      resolveStableSource: async () => {
        sourceResolved = true
        return stableSource
      },
      runBootstrap: () => {
        bootstrapRan = true
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    },
  )

  assert.equal(result.status, 'already-ready')
  assert.equal(result.onboarding.aaopVersion, '1.1.0')
  assert.equal(sourceResolved, false)
  assert.equal(bootstrapRan, false)
})

test('authorized setup delegates to exact canonical bootstrap and re-discovers installed AAOP', async () => {
  let onboardingReads = 0
  let bootstrapInput
  const result = await enableProjectAaop(
    { projectRoot: '/workspace/fixture', authorized: true },
    {
      targetIsDirectory: () => true,
      resolveOnboarding: () => {
        onboardingReads += 1
        return onboardingReads === 1 ? setupRequired() : ready('1.2.0')
      },
      resolvePythonCommand: () => 'python3',
      resolveStableSource: async () => stableSource,
      runBootstrap: (input) => {
        bootstrapInput = input
        return { exitCode: 0, stdout: 'AAOP READY', stderr: '' }
      },
    },
  )

  assert.equal(result.status, 'installed')
  assert.equal(result.sourceRevision, revision)
  assert.equal(result.aaopVersion, '1.2.0')
  assert.equal(result.onboarding.status, 'ready')
  assert.equal(onboardingReads, 2)
  assert.equal(bootstrapInput.projectRoot, '/workspace/fixture')
  assert.equal(bootstrapInput.pythonCommand, 'python3')
  assert.equal(bootstrapInput.source.revision, revision)
})

test('ambiguous pre-existing .aaop state blocks before source resolution or mutation', async () => {
  let sourceResolved = false
  const result = await enableProjectAaop(
    { projectRoot: '/workspace/fixture', authorized: true },
    {
      targetIsDirectory: () => true,
      resolveOnboarding: () => ({
        status: 'blocked',
        project: projectIdentity(),
        reason: 'Cannot prove AAOP ownership.',
      }),
      resolveStableSource: async () => {
        sourceResolved = true
        return stableSource
      },
    },
  )

  assert.equal(result.status, 'failed')
  assert.equal(result.reason, 'Cannot prove AAOP ownership.')
  assert.equal(sourceResolved, false)
})

test('bootstrap failure remains a failed setup instead of pretending onboarding succeeded', async () => {
  let onboardingReads = 0
  const result = await enableProjectAaop(
    { projectRoot: '/workspace/fixture', authorized: true },
    {
      targetIsDirectory: () => true,
      resolveOnboarding: () => {
        onboardingReads += 1
        return setupRequired()
      },
      resolvePythonCommand: () => 'python3',
      resolveStableSource: async () => stableSource,
      runBootstrap: () => ({ exitCode: 3, stdout: '', stderr: 'bootstrap failed' }),
    },
  )

  assert.equal(result.status, 'failed')
  assert.match(result.reason, /bootstrap failed/)
  assert.equal(result.sourceRevision, revision)
  assert.equal(onboardingReads, 1)
})

test('post-bootstrap release mismatch fails evidence-target verification', async () => {
  let onboardingReads = 0
  const result = await enableProjectAaop(
    { projectRoot: '/workspace/fixture', authorized: true },
    {
      targetIsDirectory: () => true,
      resolveOnboarding: () => {
        onboardingReads += 1
        return onboardingReads === 1 ? setupRequired() : ready('1.1.0')
      },
      resolvePythonCommand: () => 'python3',
      resolveStableSource: async () => stableSource,
      runBootstrap: () => ({ exitCode: 0, stdout: 'AAOP READY', stderr: '' }),
    },
  )

  assert.equal(result.status, 'failed')
  assert.match(result.reason, /release mismatch/)
  assert.equal(onboardingReads, 2)
})
