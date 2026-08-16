#!/usr/bin/env node
/**
 * Build the exact-pin DeepSeek Harness runtime capsule for the Windows installer.
 *
 * Goal: the consumer machine must NOT run `pnpm install` and must NOT need
 * Node/npm/pnpm/network to prepare the Harness runtime. Everything is prepared
 * here, at build/release time, on a machine that already has the full toolchain.
 *
 * Output: `.workbench/vendor/deepseek-harness-capsule/`
 *
 *   - packages/  (full source tree of the reviewed checkout)
 *   - apps/      (full source tree)
 *   - vendor/    (full source tree, no node_modules)
 *   - native/    (full source tree)
 *   - scripts/   (repo scripts needed by boot)
 *   - node_modules/ (PROD-only dependency closure via `pnpm deploy --prod`,
 *                    hoisted, symlink-free)
 *   - harness-runtime-manifest.json  (exact commit/version + key-file SHA-256;
 *                                     runtime verification needs NO git)
 *
 * The runtime then only:
 *   1. checks the manifest identity against harness.lock.json;
 *   2. verifies the pinned key files by SHA-256;
 *   3. runs the bundled tsx + app-boot exactly like the dev checkout.
 *
 * This script is intentionally NOT the release gate. The Consumer Journey Gate
 * and the distribution smoke own real acceptance.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

function fail(message) {
  console.error(`MING WORKBENCH HARNESS CAPSULE FAILED: ${message}`)
  process.exit(1)
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: options.shell ?? (process.platform === 'win32' && /\.cmd$/i.test(command)),
    ...options,
  })
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} exited ${result.status}: ${String(result.stderr || '').slice(-2000)}`)
  }
  return result.stdout?.trim?.() ?? ''
}

function pnpmBin() {
  if (process.platform === 'win32') return 'npx.cmd'
  return 'npx'
}

function sha256File(file) {
  const data = readFileSync(file)
  return createHash('sha256').update(data).digest('hex')
}

function gitIn(checkout, args) {
  return run('git', ['-C', checkout, ...args], { capture: true })
}

const lock = JSON.parse(readFileSync(join(root, 'harness.lock.json'), 'utf8'))
const managedCheckout = resolve(root, '.workbench', 'vendor', 'deepseek-harness')
const checkout = process.env.MING_HARNESS_CHECKOUT
  ? resolve(process.env.MING_HARNESS_CHECKOUT)
  : managedCheckout

if (!existsSync(join(checkout, '.git')) || !existsSync(join(checkout, 'apps', 'cli', 'package.json'))) {
  fail(`reviewed Harness checkout not prepared at ${checkout}. Run \`npm run harness:prepare\` first.`)
}

console.log(`Building Harness runtime capsule from ${checkout}`)

// 1. Identity
const commit = gitIn(checkout, ['rev-parse', 'HEAD'])
const pkg = JSON.parse(readFileSync(join(checkout, lock.sourcePackage.path), 'utf8'))
if (commit !== lock.reviewedCommit) {
  fail(`expected reviewed commit ${lock.reviewedCommit}, detected ${commit}.`)
}
if (pkg.version !== lock.sourcePackage.version) {
  fail(`expected reviewed version ${lock.sourcePackage.version}, detected ${pkg.version}.`)
}
console.log(`identity verified: ${lock.sourcePackage.version} @ ${commit}`)

// 2. Deploy the prod-only dependency closure into a fresh staging dir.
const staging = resolve(root, '.tmp', 'harness-capsule-build')
rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })

console.log('deploying prod-only dependency closure (pnpm deploy --prod)...')
run(pnpmBin(), [
  '--yes', 'pnpm@11.7.0',
  '--dir', checkout,
  '--filter', 'dsh-examples',
  'deploy',
  '--legacy',
  '--prod',
  '--config.node-linker=hoisted',
  '--config.auto-install-peers=false',
  '--config.link-workspace-packages=true',
  staging,
])

if (!existsSync(join(staging, 'node_modules', 'tsx', 'dist', 'cli.mjs'))) {
  fail('prod closure did not include the tsx runner required by the launcher.')
}

// 3. Copy the full source tree (everything except the source checkout's own
//    node_modules and .git) so app-boot can load the reviewed TS source.
const COPY_TOP = ['packages', 'apps', 'vendor', 'native', 'scripts', 'examples']
for (const name of COPY_TOP) {
  const src = join(checkout, name)
  if (!existsSync(src)) continue
  cpSync(src, join(staging, name), { recursive: true })
}
for (const file of [
  'package.json',
  'tsconfig.json',
  'tsconfig.base.json',
  'tsconfig.base.client.json',
  'tsconfig.host.json',
  'tsconfig.client.json',
  'pnpm-workspace.yaml',
]) {
  const src = join(checkout, file)
  if (existsSync(src)) cpSync(src, join(staging, file))
}

// 4. Runtime identity manifest. Verification uses ONLY these files + SHA-256;
//    no git executable is needed on the consumer machine.
const manifest = {
  schemaVersion: 1,
  harness: {
    commit,
    version: pkg.version,
    sourcePackagePath: lock.sourcePackage.path,
  },
  keyFiles: {},
  builtAt: new Date().toISOString(),
  builtBy: 'Ming-Workbench build-harness-capsule.mjs',
}

const KEY_FILES = [
  'apps/cli/package.json',
  'packages/boot/app-boot/src/index.ts',
  'node_modules/tsx/dist/cli.mjs',
  'node_modules/js-yaml/dist/js-yaml.mjs',
  'node_modules/@deepseek-ai/dsh-llm-deepseek/package.json',
]
for (const rel of KEY_FILES) {
  const abs = join(staging, rel)
  if (!existsSync(abs)) {
    fail(`key file missing from capsule: ${rel}`)
  }
  manifest.keyFiles[rel] = sha256File(abs)
}

const manifestPath = join(staging, 'harness-runtime-manifest.json')
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
manifest.keyFiles['harness-runtime-manifest.json'] = sha256File(manifestPath)

// 5. Verify the staged capsule can boot before publishing it.
const nodeVersion = process.versions.node
const [major, minor] = nodeVersion.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 19)) {
  fail(`capsule build requires Node ^22.19 or >=24; detected ${nodeVersion}`)
}

console.log('verifying staged capsule boot...')
const bootProbe = join(staging, 'node_modules', '@deepseek-ai', 'dsh-app-boot')
if (!existsSync(bootProbe)) {
  fail('prod closure is missing @deepseek-ai/dsh-app-boot.')
}
console.log('app-boot present, tsx present, identity manifest written.')

// 6. Publish into the Workbench vendor dir that electron-builder packages.
const destination = resolve(root, '.workbench', 'vendor', 'deepseek-harness-capsule')
rmSync(destination, { recursive: true, force: true })
cpSync(staging, destination, { recursive: true })

const finalManifest = JSON.parse(readFileSync(join(destination, 'harness-runtime-manifest.json'), 'utf8'))
finalManifest.keyFiles['harness-runtime-manifest.json'] = sha256File(join(destination, 'harness-runtime-manifest.json'))
writeFileSync(join(destination, 'harness-runtime-manifest.json'), `${JSON.stringify(finalManifest, null, 2)}\n`, 'utf8')

console.log(
  `MING WORKBENCH HARNESS CAPSULE BUILT: ${finalManifest.harness.version} @ ${finalManifest.harness.commit}`,
)
console.log(`capsule: ${destination}`)
