#!/usr/bin/env node
/**
 * Prepare the pinned Python runtime used by AAOP canonical bootstrap.
 *
 * Product constraint: a consumer must never install Python. This script:
 *   - on Windows: downloads the official python.org embeddable distribution,
 *     pinned by exact version + SHA-256, and stages it under
 *     `.workbench/runtime/python/` with a `python-runtime.json` identity file.
 *   - on POSIX dev machines: creates a venv from the system Python (a dev
 *     simulation of the bundled runtime so the product path is exercised the
 *     same way); it is never part of a Windows install.
 *
 * The identity manifest records version/platform/source and the SHA-256 of the
 * interpreter binary. resolveBundledPythonRuntime() re-verifies that hash on
 * every use, so a corrupted runtime is never executed silently.
 */

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { get as httpsGet } from 'node:https'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const targetDir = resolve(root, '.workbench', 'runtime', 'python')

// Exact pin. Only these distributions are accepted.
const PIN = {
  version: '3.12.10',
  platform: process.platform === 'win32' ? 'win32' : 'posix',
  win32: {
    url: 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip',
    // Official python.org SHA-256 for python-3.12.10-embed-amd64.zip.
    // Verified by downloading during review:
    // 4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3
    sha256: '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3',
  },
}

function fail(message) {
  console.error(`MING WORKBENCH PYTHON RUNTIME FAILED: ${message}`)
  process.exit(1)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: options.shell ?? false,
    ...options,
  })
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} exited ${result.status}: ${String(result.stderr || '').slice(-2000)}`)
  }
  return result.stdout?.trim?.() ?? ''
}

function sha256File(file) {
  return createHash('sha256').update(readFileSync(file)).digest('hex')
}

function writeManifest(interpreterPath) {
  const identity = {
    version: PIN.version,
    platform: PIN.platform,
    source: PIN.platform === 'win32'
      ? 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip'
      : 'system-python-venv (dev simulation)',
    sha256: sha256File(interpreterPath),
  }
  writeFileSync(
    join(targetDir, 'python-runtime.json'),
    `${JSON.stringify(identity, null, 2)}\n`,
    'utf8',
  )
  console.log(`python runtime identity: ${identity.version} (${identity.platform})`)
}

async function prepareWindows() {
  if (PIN.platform !== 'win32') return
  mkdirSync(targetDir, { recursive: true })
  const zipPath = join(targetDir, 'python-embed.zip')
  const pythonDir = join(targetDir, 'python')

  console.log(`downloading ${PIN.win32.url}`)
  await new Promise((resolvePromise, reject) => {
    const file = createWriteStream(zipPath)
    httpsGet(PIN.win32.url, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`download returned ${response.statusCode}`))
        return
      }
      response.pipe(file)
      file.on('finish', () => file.close(resolvePromise))
    }).on('error', reject)
  })

  const actual = sha256File(zipPath)
  if (actual !== PIN.win32.sha256) {
    fail(`embeddable Python SHA-256 mismatch: expected ${PIN.win32.sha256}, detected ${actual}`)
  }

  rmSync(pythonDir, { recursive: true, force: true })
  mkdirSync(pythonDir, { recursive: true })
  run('powershell', [
    '-NoProfile',
    '-Command',
    `Expand-Archive -Path '${zipPath}' -DestinationPath '${pythonDir}' -Force`,
  ])

  const interpreter = join(pythonDir, 'python.exe')
  if (!existsSync(interpreter)) fail(`embeddable Python missing at ${interpreter}`)
  writeManifest(interpreter)
  console.log(`python runtime ready: ${interpreter}`)
}

async function preparePosix() {
  if (PIN.platform !== 'posix') return
  const systemPython = process.env.PYTHON ?? 'python3'
  const version = run(systemPython, ['--version'], { capture: true })
  console.log(`system Python: ${version}`)
  rmSync(targetDir, { recursive: true, force: true })
  mkdirSync(targetDir, { recursive: true })
  run(systemPython, ['-m', 'venv', targetDir])
  const interpreter = join(targetDir, 'bin', 'python3')
  if (!existsSync(interpreter)) {
    // macOS
    const mac = join(targetDir, 'bin', 'python')
    if (existsSync(mac)) {
      run('ln', ['-s', mac, interpreter])
    } else {
      fail(`venv interpreter missing at ${interpreter}`)
    }
  }
  writeManifest(interpreter)
  console.log(`python runtime ready: ${interpreter}`)
}

await (PIN.platform === 'win32' ? prepareWindows() : preparePosix())
console.log('MING WORKBENCH PYTHON RUNTIME READY')
