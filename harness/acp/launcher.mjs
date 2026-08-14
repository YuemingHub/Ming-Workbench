#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const NAME = 'ming-workbench-acp'
const here = dirname(fileURLToPath(import.meta.url))
const inferredWorkbenchRoot = resolve(here, '..', '..')
const workbenchRoot = resolve(process.env.MING_WORKBENCH_ROOT ?? inferredWorkbenchRoot)
const harnessCheckoutRaw = process.env.MING_HARNESS_CHECKOUT

if (!harnessCheckoutRaw) {
  process.stderr.write(`${NAME}: MING_HARNESS_CHECKOUT is required\n`)
  process.exit(1)
}

const harnessCheckout = resolve(harnessCheckoutRaw)
const configPath = join(workbenchRoot, 'harness', 'acp', 'workbench.cordis.yml')
const appBootPath = join(harnessCheckout, 'packages', 'boot', 'app-boot', 'src', 'index.ts')

if (!existsSync(configPath)) {
  process.stderr.write(`${NAME}: missing Workbench ACP config: ${configPath}\n`)
  process.exit(1)
}
if (!existsSync(appBootPath)) {
  process.stderr.write(`${NAME}: reviewed Harness app-boot source not found: ${appBootPath}\n`)
  process.exit(1)
}

const appBootUrl = pathToFileURL(appBootPath).href
const { boot, installFailLoud } = await import(appBootUrl)

installFailLoud(NAME)

// `appBootUrl` anchors every bare @deepseek-ai/dsh-* plugin name to the
// reviewed Harness source checkout. Relative config plugins, if added later,
// continue to resolve beside the Workbench config file.
const ctx = await boot(NAME, configPath, undefined, undefined, appBootUrl)
let exiting = false

async function disposeAndExit(code) {
  if (exiting) return
  exiting = true
  try {
    await ctx.fiber.dispose()
  } finally {
    process.exit(code)
  }
}

// ACP owns stdout. Do not add stdout logging here.
process.stdin.on('end', () => { void disposeAndExit(0) })
process.on('SIGTERM', () => { void disposeAndExit(0) })
process.on('SIGINT', () => { void disposeAndExit(130) })
