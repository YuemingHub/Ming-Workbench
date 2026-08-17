#!/usr/bin/env node
/**
 * Prepare the packaged runtime for electron-builder.
 *
 * The Harness runtime is shipped as a SINGLE-FILE archive
 * (deepseek-harness-capsule.tar.gz) so electron-builder/makensis never has to
 * enumerate tens of thousands of small files (which caused RangeError:
 * Invalid string length). This script:
 *   1. ensures the bundled Python runtime is present;
 *   2. ensures the reviewed Harness capsule directory is present (via
 *      harness:prepare + build-harness-capsule);
 *   3. ensures the single-file archive is written;
 *   4. REMOVES the unpacked capsule directory from the workspace so the
 *      installer carries only the archive + Python runtime, not the 282MB of
 *      loose files.
 *
 * The runtime (prepareHarnessRuntime) extracts the archive to a per-user cache
 * on first launch and verifies every pinned key file by SHA-256.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

function run(command, args) {
  const result = execFileSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32' && /\.cmd$/i.test(command),
  })
  return result
}

// 1. Bundled Python runtime.
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'python:prepare'])

// 2. Reviewed Harness capsule (directory) + single-file archive.
run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'harness:prepare'])
run('node', [join(root, 'scripts', 'build-harness-capsule.mjs')])

// 3. Verify the archive exists.
const archivePath = join(root, '.workbench', 'vendor', 'deepseek-harness-capsule.tar.gz')
if (!existsSync(archivePath)) {
  throw new Error(`capsule archive missing after build: ${archivePath}`)
}

// 4. Remove the unpacked capsule directory so the installer carries only the
// single-file archive (avoids electron-builder/makensis RangeError on huge
// file counts). The runtime re-extracts from the archive.
const capsuleDir = join(root, '.workbench', 'vendor', 'deepseek-harness-capsule')
if (existsSync(capsuleDir)) {
  rmSync(capsuleDir, { recursive: true, force: true })
  console.log('removed unpacked capsule directory (archive is the carrier)')
}

console.log('packaged runtime ready (archive + bundled Python)')
