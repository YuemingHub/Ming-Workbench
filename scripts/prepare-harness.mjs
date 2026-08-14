#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const lock = JSON.parse(readFileSync(resolve(root, 'harness.lock.json'), 'utf8'))
const target = resolve(
  process.env.MING_HARNESS_CHECKOUT
    ?? resolve(root, '.workbench', 'vendor', 'deepseek-harness'),
)

const PNPM_VERSION = '11.7.0'

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    ...options,
  })?.trim?.() ?? ''
}

function git(args, capture = true) {
  return run('git', ['-C', target, ...args], { capture })
}

function normalizedRemote(value) {
  return String(value).trim().replace(/\.git$/i, '').replace(/\/$/, '')
}

function assertSupportedNode() {
  const [major, minor] = process.versions.node.split('.').map(Number)
  const supported = major >= 24 || (major === 22 && minor >= 19)
  if (!supported) {
    throw new Error(
      `DeepSeek Harness requires Node ^22.19.0 or >=24; detected ${process.version}.`,
    )
  }
}

function verifyIdentity() {
  const commit = git(['rev-parse', 'HEAD'])
  const pkgPath = resolve(target, lock.sourcePackage.path)
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))

  if (commit !== lock.reviewedCommit) {
    throw new Error(`Harness SHA mismatch after prepare: expected ${lock.reviewedCommit}, detected ${commit}.`)
  }
  if (pkg.version !== lock.sourcePackage.version) {
    throw new Error(
      `Harness source package mismatch after prepare: expected ${lock.sourcePackage.version}, detected ${pkg.version}.`,
    )
  }

  const tsxCli = resolve(target, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  if (!existsSync(tsxCli)) {
    throw new Error(`Harness dependency install did not produce its tsx CLI: ${tsxCli}`)
  }

  return { commit, version: pkg.version, tsxCli }
}

function ensureCheckout() {
  if (!existsSync(target)) {
    mkdirSync(dirname(target), { recursive: true })
    run('git', ['init', target])
    git(['remote', 'add', 'origin', lock.upstreamRepository], false)
    git(['fetch', '--depth=1', 'origin', lock.reviewedCommit], false)
    git(['checkout', '--detach', 'FETCH_HEAD'], false)
    return
  }

  if (!existsSync(resolve(target, '.git'))) {
    throw new Error(
      `Refusing to replace existing non-Git path at managed Harness target: ${target}`,
    )
  }

  const dirty = git(['status', '--porcelain'])
  if (dirty) {
    throw new Error(
      `Refusing to mutate a dirty Harness checkout at ${target}. Preserve or discard those changes explicitly first.`,
    )
  }

  const origin = git(['remote', 'get-url', 'origin'])
  if (normalizedRemote(origin) !== normalizedRemote(lock.upstreamRepository)) {
    throw new Error(
      `Harness origin mismatch: expected ${lock.upstreamRepository}, detected ${origin}.`,
    )
  }

  const current = git(['rev-parse', 'HEAD'])
  if (current !== lock.reviewedCommit) {
    git(['fetch', '--depth=1', 'origin', lock.reviewedCommit], false)
    git(['checkout', '--detach', 'FETCH_HEAD'], false)
  }
}

try {
  assertSupportedNode()
  if (!lock.upstreamRepository || !lock.reviewedCommit || !lock.sourcePackage?.version) {
    throw new Error('harness.lock.json is missing required reviewed source identity.')
  }

  console.log(`Preparing reviewed DeepSeek Harness at ${target}`)
  ensureCheckout()

  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  run(npx, [
    '-y',
    `pnpm@${PNPM_VERSION}`,
    '--dir',
    target,
    'install',
    '--frozen-lockfile',
  ])

  const identity = verifyIdentity()
  console.log(
    `MING WORKBENCH HARNESS PREPARED: ${identity.version} @ ${identity.commit}`,
  )
  console.log(`checkout: ${target}`)
  console.log(`runner: ${identity.tsxCli}`)
} catch (error) {
  console.error(`MING WORKBENCH HARNESS PREPARE FAILED: ${error.message}`)
  process.exitCode = 1
}
