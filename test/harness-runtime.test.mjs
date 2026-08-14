import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

import { prepareHarnessRuntime } from '../.tmp/index.js'

const REPO_ROOT = resolve(process.cwd())
const REAL_BUNDLE = resolve(REPO_ROOT, '.workbench', 'vendor', 'deepseek-harness-0.1.0-rc.5.bundle')
const REAL_LOCK = resolve(REPO_ROOT, 'harness.lock.json')
const TMP = resolve(REPO_ROOT, '.tmp', 'harness-runtime-test')

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

test('real bundled runtime extracts and verifies identity', async () => {
  const workbenchRoot = setupTestDir()
  try {
    const bundledDir = join(workbenchRoot, '.workbench', 'runtime', 'deepseek-harness')
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
    assert.equal(result.identity.version, '0.1.0-rc.5')
    assert.equal(result.identity.commit, '47f943859bef60e4160492346772ded9b24f765a')
  } finally {
    cleanup(workbenchRoot)
  }
})

test('bundled runtime caches and reuses valid checkout', async () => {
  const workbenchRoot = setupTestDir()
  try {
    const bundledDir = join(workbenchRoot, '.workbench', 'runtime', 'deepseek-harness')
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
  try {
    mkdirSync(join(workbenchRoot, '.workbench', 'vendor'), { recursive: true })
    writeFileSync(join(workbenchRoot, 'harness.lock.json'), readFileSync(REAL_LOCK))

    await assert.rejects(
      prepareHarnessRuntime({ workbenchRoot }),
      /bundle not found/,
    )
  } finally {
    cleanup(workbenchRoot)
  }
})
