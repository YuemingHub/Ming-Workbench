import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { startLocalWorkbenchServer } from '../.tmp/index.js'
import { startHumanFirstServer } from '../.tmp/idea/index.js'

function usage() {
  return [
    'Usage:',
    '  npm run web:local -- --project <path> [--port <number>] [--harness-checkout <path>]',
    '  npm run web:local -- [--mode human-first] [--store-dir <path>] [--port <number>]',
    '',
    '--project: project mode, fixes the selected project for the process lifetime.',
    'without --project: human-first V1 entry (letter/conversation, no project, no harness).',
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
    if (arg === '--project' || arg === '--port' || arg === '--harness-checkout' || arg === '--workbench-root' || arg === '--store-dir' || arg === '--mode') {
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

function providerEndpointFromEnv() {
  const apiKey = process.env.DEEPSEEK_API_KEY ?? ''
  const baseUrl = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com/v1'
  const model = process.env.MING_HARNESS_MODEL ?? 'deepseek-chat'
  return { baseUrl, apiKey, model }
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

const workbenchRoot = resolve(args['workbench-root'] ?? process.cwd())
const port = args.port === undefined ? 0 : Number(args.port)
const storeDir = args['store-dir']
  ? resolve(args['store-dir'])
  : resolve(workbenchRoot, '.ming-workbench', 'store')

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error('--port must be an integer from 0 through 65535')
  process.exit(2)
}

const humanFirstMode = !args.project || args.mode === 'human-first'

let handle
let closing = false

if (humanFirstMode) {
  if (args.project) {
    // Explicit --mode human-first with a stray --project is ambiguous.
    console.error('Cannot combine --project with --mode human-first')
    process.exit(2)
  }
  handle = await startHumanFirstServer({
    workbenchRoot,
    storeDir,
    provider: providerEndpointFromEnv(),
    port,
  })
  console.log('Ming Workbench human-first V1 entry is ready.')
  console.log(`  open: ${handle.url}`)
  console.log('  no project required; no harness/AAOP started')
  console.log(`MING_WORKBENCH_READY ${handle.url}`)
} else {
  const projectRoot = resolve(args.project)
  const harnessCheckout = resolve(
    args['harness-checkout']
      ?? process.env.MING_HARNESS_CHECKOUT
      ?? `${workbenchRoot}/.workbench/vendor/deepseek-harness`,
  )
  if (!existsSync(projectRoot)) {
    console.error(`Project directory does not exist: ${projectRoot}`)
    process.exit(2)
  }
  handle = await startLocalWorkbenchServer({
    projectRoot,
    workbenchRoot,
    harnessCheckout,
    provider: process.env.MING_HARNESS_PROVIDER,
    model: process.env.MING_HARNESS_MODEL,
    sessionRoot: process.env.MING_WORKBENCH_SESSION_ROOT,
    port,
    storeDir,
  })
  console.log('Ming Workbench local UI is ready.')
  console.log(`  project: ${projectRoot}`)
  console.log(`  open: ${handle.url}`)
  console.log('  first step: read-only project understanding')
  console.log(`MING_WORKBENCH_READY ${handle.url}`)
}

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
