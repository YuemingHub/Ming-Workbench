import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { resolveHarnessTsxCli } from '../.tmp/transports/harness-acp.js'

test('Harness transport resolves the checkout-local tsx CLI without global pnpm', () => {
  const path = resolveHarnessTsxCli('/runtime/deepseek-harness').replaceAll('\\', '/')
  assert.equal(path, '/runtime/deepseek-harness/node_modules/tsx/dist/cli.mjs')
})

test('prepare script pins the reviewed source and refuses destructive checkout repair', () => {
  const script = readFileSync(
    new URL('../scripts/prepare-harness.mjs', import.meta.url),
    'utf8',
  )

  assert.match(script, /harness\.lock\.json/)
  assert.match(script, /\.workbench.*vendor.*deepseek-harness/s)
  assert.match(script, /pnpm@\$\{PNPM_VERSION\}/)
  assert.match(script, /PNPM_VERSION = '11\.7\.0'/)
  assert.match(script, /Refusing to replace existing non-Git path/)
  assert.match(script, /Refusing to mutate a dirty Harness checkout/)
  assert.match(script, /Harness origin mismatch/)
  assert.match(script, /lock\.reviewedCommit/)
  assert.match(script, /--frozen-lockfile/)
  assert.match(script, /node_modules.*tsx.*dist.*cli\.mjs/s)
})

test('Workbench command surface exposes one-command Harness preparation', () => {
  const pkg = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  )
  assert.equal(pkg.scripts['harness:prepare'], 'node ./scripts/prepare-harness.mjs')
})

test('managed Harness checkout is excluded from tracked Workbench state', () => {
  const gitignore = readFileSync(new URL('../.gitignore', import.meta.url), 'utf8')
  assert.match(gitignore, /^\.workbench\/vendor\/$/m)
})
