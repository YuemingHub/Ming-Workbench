import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve, basename } from 'node:path'
import { randomUUID } from 'node:crypto'

import {
  prepareHarnessRuntime,
  resolvePnpmInvocation,
  executableKind,
  sanitizeDiagnosticText,
} from '../.tmp/index.js'

const REPO_ROOT = resolve(process.cwd())
const REAL_BUNDLE = resolve(REPO_ROOT, '.workbench', 'vendor', 'deepseek-harness-0.1.0-rc.5.bundle')
const REAL_LOCK = resolve(REPO_ROOT, 'harness.lock.json')
const TMP = resolve(REPO_ROOT, '.tmp', 'harness-runtime-test')

// Harness runtime integration tests require the reviewed git bundle AND network
// access to run `pnpm install --frozen-lockfile`. Those are CI-owned (exact-head
// CI sets MING_HARNESS_TEST=1). Locally they are skipped so `npm test` stays fast
// and never hangs on network.
const RUN_INTEGRATION = process.env.MING_HARNESS_TEST === '1' && existsSync(REAL_BUNDLE)

function setupTestDir() {
  const id = randomUUID()
  const dir = join(TMP, id)
  mkdirSync(dir, { recursive: true })
  return dir
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true })
  } catch {
    // Best-effort.
  }
}

// The bundled runtime now extracts under a per-user cache (MING_HARNESS_CACHE,
// default os.tmpdir()/ming-workbench-harness) so the packaged app stays under
// MAX_PATH on Windows. Each test that touches the bundled path MUST point the
// cache at a fresh empty directory, otherwise a leftover extraction from a
// previous run makes the "missing bundle" case reuse a valid cached checkout.
function withFreshHarnessCache() {
  const cacheDir = join(TMP, 'cache-' + randomUUID())
  const previous = process.env.MING_HARNESS_CACHE
  process.env.MING_HARNESS_CACHE = cacheDir
  return {
    cacheDir,
    bundledDir: join(cacheDir, 'deepseek-harness'),
    restore() {
      if (previous === undefined) delete process.env.MING_HARNESS_CACHE
      else process.env.MING_HARNESS_CACHE = previous
    },
  }
}

test('real bundled runtime extracts and verifies identity', { skip: !RUN_INTEGRATION }, async () => {
  const workbenchRoot = setupTestDir()
  const cache = withFreshHarnessCache()
  try {
    const bundledDir = cache.bundledDir
    mkdirSync(join(workbenchRoot, '.workbench', 'vendor'), { recursive: true })
    // Copy real bundle and lock.
    writeFileSync(
      join(workbenchRoot, '.workbench', 'vendor', 'deepseek-harness-0.1.0-rc.5.bundle'),
      readFileSync(REAL_BUNDLE),
    )
    writeFileSync(join(workbenchRoot, 'harness.lock.json'), readFileSync(REAL_LOCK))

    const result = await prepareHarnessRuntime({ workbenchRoot })
    assert.equal(result.source, 'bundled')
    assert.ok(existsSync(join(result.checkout, 'apps', 'cli', 'package.json')))
    assert.equal(result.checkout, bundledDir)
    assert.equal(result.identity.version, '0.1.0-rc.5')
    assert.equal(result.identity.commit, '47f943859bef60e4160492346772ded9b24f765a')
  } finally {
    cleanup(workbenchRoot)
    cache.restore()
  }
})

test('bundled runtime caches and reuses valid checkout', { skip: !RUN_INTEGRATION }, async () => {
  const workbenchRoot = setupTestDir()
  const cache = withFreshHarnessCache()
  try {
    const bundledDir = cache.bundledDir
    mkdirSync(join(workbenchRoot, '.workbench', 'vendor'), { recursive: true })
    writeFileSync(
      join(workbenchRoot, '.workbench', 'vendor', 'deepseek-harness-0.1.0-rc.5.bundle'),
      readFileSync(REAL_BUNDLE),
    )
    writeFileSync(join(workbenchRoot, 'harness.lock.json'), readFileSync(REAL_LOCK))

    // First call extracts.
    const first = await prepareHarnessRuntime({ workbenchRoot })
    assert.equal(first.source, 'bundled')

    // Second call reuses cached.
    const second = await prepareHarnessRuntime({ workbenchRoot })
    assert.equal(second.source, 'bundled')
    assert.equal(second.checkout, bundledDir)
  } finally {
    cleanup(workbenchRoot)
    cache.restore()
  }
})

test('explicit path option resolves and verifies identity', async () => {
  // Use the actual prepared Harness checkout as the explicit path.
  const explicitCheckout = resolve(REPO_ROOT, '.workbench', 'vendor', 'deepseek-harness')
  if (!existsSync(join(explicitCheckout, 'apps', 'cli', 'package.json'))) {
    console.log('SKIP: Harness checkout not prepared')
    return
  }

  const workbenchRoot = setupTestDir()
  try {
    mkdirSync(join(workbenchRoot, '.workbench', 'vendor'), { recursive: true })
    writeFileSync(join(workbenchRoot, 'harness.lock.json'), readFileSync(REAL_LOCK))

    const result = await prepareHarnessRuntime({
      workbenchRoot,
      harnessCheckout: explicitCheckout,
    })
    assert.equal(result.source, 'existing')
    assert.equal(result.identity.commit, '47f943859bef60e4160492346772ded9b24f765a')
    assert.equal(result.identity.version, '0.1.0-rc.5')
  } finally {
    cleanup(workbenchRoot)
  }
})

test('missing bundle produces actionable error', async () => {
  const workbenchRoot = setupTestDir()
  const cache = withFreshHarnessCache()
  try {
    mkdirSync(join(workbenchRoot, '.workbench', 'vendor'), { recursive: true })
    writeFileSync(join(workbenchRoot, 'harness.lock.json'), readFileSync(REAL_LOCK))

    await assert.rejects(
      prepareHarnessRuntime({ workbenchRoot }),
      /bundle not found/,
    )
  } finally {
    cleanup(workbenchRoot)
    cache.restore()
  }
})

test('resolvePnpmInvocation uses bundled pnpm through the current executable', () => {
  const checkout = join(TMP, 'pnpm-checkout')
  const invocation = resolvePnpmInvocation(REPO_ROOT, checkout)

  assert.equal(invocation.executable, process.execPath)
  assert.equal(basename(invocation.args[0]), 'pnpm.cjs')
  assert.ok(invocation.args.includes('--dir'))
  assert.ok(invocation.args.includes(checkout))
  assert.ok(invocation.args.includes('install'))
  assert.ok(invocation.args.includes('--no-frozen-lockfile'))
  assert.ok(invocation.args.includes('--config.node-linker=hoisted'))

  // Packaged Electron runs the bundled pnpm through the app binary; the child
  // must be told to act as Node, and only that child (never the app env).
  assert.equal(invocation.env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(invocation.env.PNPM_HOME, process.env.PNPM_HOME ?? join(REPO_ROOT, '.workbench', 'pnpm-store'))
  assert.equal(invocation.shell, false)
  assert.equal(process.env.ELECTRON_RUN_AS_NODE, undefined)
})

test('resolvePnpmInvocation falls back to npx without polluting other calls', () => {
  const root = setupTestDir()
  try {
    const invocation = resolvePnpmInvocation(root, join(root, 'checkout'))

    assert.equal(invocation.kind, 'npx')
    assert.equal(invocation.executable, process.platform === 'win32' ? 'npx.cmd' : 'npx')
    assert.deepEqual(invocation.args.slice(0, 2), ['-y', 'pnpm@11.7.0'])
    assert.equal(invocation.shell, process.platform === 'win32')
    // The npx fallback must not inherit Electron node-mode.
    assert.equal(invocation.env.ELECTRON_RUN_AS_NODE, undefined)
    assert.equal(process.env.ELECTRON_RUN_AS_NODE, undefined)
  } finally {
    cleanup(root)
  }
})

test('executableKind classifies packaged Electron, node and npx executables', () => {
  assert.equal(executableKind('Ming Workbench.exe'), 'electron-process-exec')
  assert.equal(executableKind('D:\\apps\\Ming Workbench.exe'), 'electron-process-exec')
  assert.equal(executableKind('node.exe'), 'node')
  assert.equal(executableKind('/usr/bin/node'), 'node')
  assert.equal(executableKind('npx.cmd'), 'npx')
  assert.equal(executableKind('npx'), 'npx')
})

test('sanitizeDiagnosticText redacts secret env values', () => {
  const previous = process.env.MING_TEST_SECRET_P0_DO_NOT_LEAK
  process.env.MING_TEST_SECRET_P0_DO_NOT_LEAK = 'SENTINEL-XYZ-123'
  try {
    const out = sanitizeDiagnosticText('boom SENTINEL-XYZ-123 boom')
    assert.ok(!out.includes('SENTINEL-XYZ-123'))
    assert.ok(out.includes('[REDACTED:MING_TEST_SECRET_P0_DO_NOT_LEAK]'))
  } finally {
    if (previous === undefined) delete process.env.MING_TEST_SECRET_P0_DO_NOT_LEAK
    else process.env.MING_TEST_SECRET_P0_DO_NOT_LEAK = previous
  }
})

test('sanitizeDiagnosticText redacts credential-shaped strings', () => {
  // Build fixtures from parts so the source never contains a literal
  // credential-shaped string (GitHub push protection flags the shape).
  const slackToken = `xox${'b'}-` + '1234567890123-' + 'abcdefghijklmnopqrstuvwxyz'
  const out = sanitizeDiagnosticText(
    'key=sk-abcdefghijklmnopqrstuvwxyz0123456789ABCDEF ' +
    'token=ghp_1234567890123456789012345678901234567890 ' +
    'gcp=AIzaabcdefghijklmnopqrstuvwxyz0123456789 ' +
    `slack=${slackToken}`,
  )
  assert.ok(!/sk-[A-Za-z0-9_-]{12,}/.test(out))
  assert.ok(!/gh[pousr]_/.test(out))
  assert.ok(!/AIza/.test(out))
  assert.ok(!/xox[baprs]-/.test(out))
  assert.ok(out.includes('[REDACTED-API-KEY]'))
  assert.ok(out.includes('[REDACTED-TOKEN]'))
})
