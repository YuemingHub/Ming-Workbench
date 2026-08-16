import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { spawnBackend, parseBackendReadyLine } from '../desktop/backend.mjs'

const TEST_SECRET = 'MING_TEST_SECRET_P0_DO_NOT_LEAK'

/**
 * A fake backend script that reports the child env it actually received and
 * then prints the canonical MING_WORKBENCH_READY handshake. The probe output
 * is written to MING_PROBE_OUT so the test can assert what the child really
 * saw without relying on process-tree introspection.
 */
function writeFakeBackendScript(dir) {
  const script = join(dir, 'fake-backend.mjs')
  writeFileSync(
    script,
    `import { writeFileSync } from 'node:fs'
const out = process.env.MING_PROBE_OUT
if (out) {
  writeFileSync(out, JSON.stringify({
    hasSecret: Object.prototype.hasOwnProperty.call(process.env, 'DEEPSEEK_API_KEY'),
    secret: process.env.DEEPSEEK_API_KEY ?? null,
    argv: process.argv,
  }))
}
console.log('MING_WORKBENCH_READY http://127.0.0.1:1')
setTimeout(() => process.exit(0), 500)
`,
    'utf8',
  )
  return script
}

function readProbe(probePath) {
  if (!existsSync(probePath)) return null
  return JSON.parse(readFileSync(probePath, 'utf8'))
}

test('backend child receives no provider secret when none is injected', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mw-activation-'))
  const script = writeFakeBackendScript(dir)
  const probePath = join(dir, 'probe1.json')
  const projectRoot = mkdtempSync(join(tmpdir(), 'mw-activation-project-'))

  const handle = spawnBackend({
    nodeBin: process.execPath,
    script,
    projectRoot,
    workbenchRoot: dir,
    harnessCheckout: dir,
    storeDir: dir,
    extraEnv: { MING_PROBE_OUT: probePath },
  })
  const url = await handle.ready
  assert.equal(url, 'http://127.0.0.1:1')
  await new Promise((r) => setTimeout(r, 300))
  const probe = readProbe(probePath)
  assert.ok(probe, 'probe output missing')
  assert.equal(probe.hasSecret, false)
  assert.equal(probe.secret, null)
  await handle.kill()
})

test('after saving a secret, a newly spawned backend child receives it via env, not argv', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'mw-activation-'))
  const script = writeFakeBackendScript(dir)
  const probePath = join(dir, 'probe2.json')
  const projectRoot = mkdtempSync(join(tmpdir(), 'mw-activation-project-'))

  // This mirrors desktop/main.mjs restartBackendForProviderActivation: the
  // same fixed project is respawned with the updated provider secret in env.
  const handle = spawnBackend({
    nodeBin: process.execPath,
    script,
    projectRoot,
    workbenchRoot: dir,
    harnessCheckout: dir,
    storeDir: dir,
    extraEnv: { MING_PROBE_OUT: probePath, DEEPSEEK_API_KEY: TEST_SECRET },
  })
  const url = await handle.ready
  assert.equal(url, 'http://127.0.0.1:1')
  await new Promise((r) => setTimeout(r, 300))
  const probe = readProbe(probePath)
  assert.ok(probe, 'probe output missing')
  assert.equal(probe.hasSecret, true)
  assert.equal(probe.secret, TEST_SECRET)

  // The plaintext secret must never appear in the child argv.
  const argvText = JSON.stringify(probe.argv)
  assert.equal(argvText.includes(TEST_SECRET), false, 'secret leaked into child argv')

  await handle.kill()
})

test('provider activation restart path is wired in the desktop main process', () => {
  const source = readFileSync(
    new URL('../desktop/main.mjs', import.meta.url),
    'utf8',
  )
  // Saving a secret must trigger a controlled backend restart for the SAME
  // fixed project (hot activation), not require an app restart.
  assert.match(
    source,
    /desktop:set-provider-secret[\s\S]*?restartBackendForProviderActivation/,
  )
  // The restart must reuse the existing startBackend lifecycle (kill old
  // backend -> clear origin -> spawn with updated secret env -> ready ->
  // atomic origin rotation) and then navigate the window to the fresh
  // origin (a plain reload would hit the dead old port) so the renderer
  // picks up the fresh request token and resumes persisted state.
  assert.match(source, /async function restartBackendForProviderActivation/)
  assert.match(source, /const url = await startBackend\(currentProjectRoot\)/)
  assert.match(source, /win\.loadURL\(url\)/)
  // No secret may ever enter argv: every line mentioning the key must be the
  // child-env injection or a comment, never an argument-list write.
  const keyLines = source.split('\n').filter((line) => line.includes('DEEPSEEK_API_KEY'))
  assert.ok(keyLines.length >= 1, 'expected DEEPSEEK_API_KEY injection in main.mjs')
  for (const line of keyLines) {
    assert.match(
      line,
      /extraEnv|spawned with the updated|DEEPSEEK_API_KEY: providerSecret/,
      `DEEPSEEK_API_KEY appears outside extraEnv injection: ${line.trim()}`,
    )
  }
})
