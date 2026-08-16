import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

import {
  resolveBundledPythonRuntime,
  resolveProductPythonCommand,
  defaultBundledPythonDir,
} from '../.tmp/projects/python-runtime.js'

const REPO_ROOT = resolve(process.cwd())
const TMP = resolve(REPO_ROOT, '.tmp', 'python-runtime-test')

function setupTestDir() {
  const dir = join(TMP, randomUUID())
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

test('bundled Python runtime is resolved only when identity manifest exists', () => {
  const workbenchRoot = setupTestDir()
  try {
    // No manifest yet -> no bundled runtime.
    const missing = resolveBundledPythonRuntime(workbenchRoot)
    assert.equal(missing.executable, undefined)
    assert.equal(missing.identity, undefined)

    // Wrong layout (manifest without interpreter) -> no executable.
    mkdirSync(join(workbenchRoot, '.workbench', 'runtime', 'python'), { recursive: true })
    writeFileSync(
      join(workbenchRoot, '.workbench', 'runtime', 'python', 'python-runtime.json'),
      JSON.stringify({ version: '3.12', platform: 'linux', source: 'test' }),
    )
    const noExec = resolveBundledPythonRuntime(workbenchRoot)
    assert.equal(noExec.executable, undefined)
  } finally {
    cleanup(workbenchRoot)
  }
})

test('bundled Python runtime re-verifies interpreter SHA-256', () => {
  const workbenchRoot = setupTestDir()
  try {
    const pythonDir = join(workbenchRoot, '.workbench', 'runtime', 'python', 'bin')
    mkdirSync(pythonDir, { recursive: true })
    const python = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], {
      encoding: 'utf8',
    }).trim()
    const target = join(pythonDir, 'python3')
    execFileSync('cp', [python, target])

    const hash = createHash('sha256').update(readFileSync(target)).digest('hex')
    writeFileSync(
      join(workbenchRoot, '.workbench', 'runtime', 'python', 'python-runtime.json'),
      JSON.stringify({ version: '3.11', platform: 'linux', source: 'test', sha256: hash }),
    )

    const valid = resolveBundledPythonRuntime(workbenchRoot)
    assert.equal(valid.executable, target)

    // Corrupted interpreter -> refused (sha mismatch).
    writeFileSync(target, '#!/bin/sh\necho corrupted\n')
    const corrupted = resolveBundledPythonRuntime(workbenchRoot)
    assert.equal(corrupted.executable, undefined)
  } finally {
    cleanup(workbenchRoot)
  }
})

test('resolveProductPythonCommand prefers bundled Python over system Python', () => {
  const workbenchRoot = setupTestDir()
  try {
    // No bundled runtime -> falls back to system python.
    const system = resolveProductPythonCommand(workbenchRoot, 'linux')
    assert.ok(system === 'python3' || system === 'python', `expected a system python command, got ${system}`)

    // With bundled runtime present -> bundled executable wins.
    const pythonDir = join(workbenchRoot, '.workbench', 'runtime', 'python', 'bin')
    mkdirSync(pythonDir, { recursive: true })
    const python = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], {
      encoding: 'utf8',
    }).trim()
    const target = join(pythonDir, 'python3')
    execFileSync('cp', [python, target])
    const hash = createHash('sha256').update(readFileSync(target)).digest('hex')
    writeFileSync(
      join(workbenchRoot, '.workbench', 'runtime', 'python', 'python-runtime.json'),
      JSON.stringify({ version: '3.11', platform: 'linux', source: 'test', sha256: hash }),
    )
    const bundled = resolveProductPythonCommand(workbenchRoot, 'linux')
    assert.equal(bundled, target)
  } finally {
    cleanup(workbenchRoot)
  }
})

test('defaultBundledPythonDir points under workbench runtime', () => {
  assert.equal(
    defaultBundledPythonDir('/x'),
    resolve('/x', '.workbench', 'runtime', 'python'),
  )
})
