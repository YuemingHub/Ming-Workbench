import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { startLocalWorkbenchServer } from '../.tmp/index.js'

function usage() {
  return [
    'Usage:',
    '  npm run web:local -- --project <path> [--port <number>] [--harness-checkout <path>]',
    '',
    'The local UI binds only to 127.0.0.1 and fixes the selected project for the lifetime of the process.',
  ].join('\n')
}

function readArgs(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--project' || arg === '--port' || arg === '--harness-checkout' || arg === '--workbench-root') {
      const value = argv[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`${arg} requires a value`)
      }
      options[arg.slice(2)] = value
      index += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }
  return options
}

let args
try {
  args = readArgs(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error(usage())
  process.exit(2)
}

if (args.help) {
  console.log(usage())
  process.exit(0)
}

if (!args.project) {
  console.error('--project is required')
  console.error(usage())
  process.exit(2)
}

const workbenchRoot = resolve(args['workbench-root'] ?? process.cwd())
const projectRoot = resolve(args.project)
const harnessCheckout = resolve(
  args['harness-checkout']
    ?? process.env.MING_HARNESS_CHECKOUT
    ?? `${workbenchRoot}/.workbench/vendor/deepseek-harness`,
)
const port = args.port === undefined ? 0 : Number(args.port)

if (!existsSync(projectRoot)) {
  console.error(`Project directory does not exist: ${projectRoot}`)
  process.exit(2)
}
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('--port must be an integer from 0 through 65535')
  process.exit(2)
}

const handle = await startLocalWorkbenchServer({
  projectRoot,
  workbenchRoot,
  harnessCheckout,
  provider: process.env.MING_HARNESS_PROVIDER,
  model: process.env.MING_HARNESS_MODEL,
  sessionRoot: process.env.MING_WORKBENCH_SESSION_ROOT,
  port,
})

console.log('Ming Workbench local UI is ready.')
console.log(`  project: ${projectRoot}`)
console.log(`  open: ${handle.url}`)
console.log('  first step: read-only project understanding')
console.log('Press Ctrl+C to stop.')

let closing = false
async function close(code = 0) {
  if (closing) return
  closing = true
  try {
    await handle.close()
  } finally {
    process.exit(code)
  }
}

process.on('SIGINT', () => { void close(130) })
process.on('SIGTERM', () => { void close(0) })
