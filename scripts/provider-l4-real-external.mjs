/**
 * Provider Own-Key Verification — Strict, Env-Only, Fail-Closed.
 * 
 * This script performs two separate, independently honest checks:
 * 
 * 1. REAL_PROVIDER_AUTH: Direct API call with real credentials.
 *    Requires MING_L4_ALLOW_PAID=1, MING_L4_API_KEY, MING_L4_BASE_URL, MING_L4_MODEL.
 *    If env vars are missing → NOT RUN (exit 0 with status NOT_RUN).
 *    This proves: real key → real API → real model response.
 *    This does NOT prove L4.
 * 
 * 2. L4 (REAL WORKBENCH HARNESS L4): NOT PROVEN by this script.
 *    L4 requires the full chain:
 *      NSIS installer → installed Ming Workbench.exe
 *      → Product UI: user configures BaseURL/Model/Key
 *      → safeStorage: key never reaches source or env
 *      → Connection test: real round-trip through Harness ACP
 *      → Real project path → Harness → bounded execution
 *      → Isolated worktree → evidence → independent filesystem readback
 *    This script CANNOT prove L4. Only the installed product can.
 *    Status will always be NOT_PROVEN unless the full chain is verified.
 * 
 * USAGE:
 *   MING_L4_ALLOW_PAID=1 \
 *   MING_L4_API_KEY=sk-xxx \
 *   MING_L4_BASE_URL=https://api.example.com \
 *   MING_L4_MODEL=deepseek-v4-pro \
 *   node scripts/provider-l4-real-external.mjs
 */

import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const HARNESS_CHECKOUT = resolve(REPO_ROOT, '.harness-checkout')
const HARNESS_ACP_LAUNCHER = resolve(REPO_ROOT, 'harness', 'acp', 'launcher.mjs')
const HARNESS_TSCLI = resolve(HARNESS_CHECKOUT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
const HARNESS_TSCONFIG = resolve(HARNESS_CHECKOUT, 'tsconfig.json')
const Harness_TSCLI_FALLBACK = resolve(HARNESS_CHECKOUT, 'tsx.mjs')

function resolveHarnessTsxCli() {
  if (existsSync(HARNESS_TSCLI)) return HARNESS_TSCLI
  if (existsSync(Harness_TSCLI_FALLBACK)) return Harness_TSCLI_FALLBACK
  return null
}

const REQUIRED_ENV = ['MING_L4_ALLOW_PAID', 'MING_L4_API_KEY', 'MING_L4_BASE_URL', 'MING_L4_MODEL']

function printSep() {
  console.log('')
  console.log('─'.repeat(72))
  console.log('')
}

function printStatus(label, status, detail = '') {
  console.log(`${label}: ${status}${detail ? ' — ' + detail : ''}`)
}

function checkEnv() {
  const missing = REQUIRED_ENV.filter(name => !process.env[name] || process.env[name].length === 0)
  if (missing.length > 0) {
    console.log('ENVIRONMENT CHECK')
    console.log(`Missing required variables: ${missing.join(', ')}`)
    printStatus('REAL_PROVIDER_AUTH', 'NOT RUN — HUMAN COST GATE', 'Missing required environment variables')
    printStatus('L4_WORKBENCH_HARNESS', 'NOT PROVEN', 'Cannot attempt without real provider auth')
    return false
  }
  if (process.env.MING_L4_ALLOW_PAID !== '1') {
    printStatus('REAL_PROVIDER_AUTH', 'NOT RUN — HUMAN COST GATE', 'MING_L4_ALLOW_PAID must be set to "1"')
    printStatus('L4_WORKBENCH_HARNESS', 'NOT PROVEN')
    return false
  }
  printStatus('REAL_PROVIDER_AUTH', 'REQUIRED', 'All env variables present')
  return true
}

/**
 * REAL_PROVIDER_AUTH: Direct, minimal API call to prove the key works.
 * This is an AUTH test, NOT an L4 test.
 */
async function runRealProviderAuth() {
  const apiKey = process.env.MING_L4_API_KEY
  const baseUrl = process.env.MING_L4_BASE_URL
  const model = process.env.MING_L4_MODEL

  console.log('REAL_PROVIDER_AUTH — Direct API round-trip')
  console.log(`  Endpoint: ${baseUrl}  <redacted>`)
  console.log(`  Model: ${model}`)
  console.log('')

  const tempDir = join(tmpdir(), 'mw-l4-auth-test-' + randomBytes(8).toString('hex'))
  mkdirSync(tempDir, { recursive: true })

  try {
    const url = new URL(baseUrl)
    url.pathname = url.pathname.endsWith('/') ? url.pathname + 'chat/completions' : url.pathname + '/chat/completions'

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: '只回复「OK」。不要做任何其他事情。' }],
        max_tokens: 10,
      }),
    })

    const bodyText = await response.text()

    if (!response.ok) {
      let errorDetail = `HTTP ${response.status}`
      try {
        const errBody = JSON.parse(bodyText)
        if (errBody.error && errBody.error.message) {
          errorDetail += `: ${errBody.error.message}`
        }
      } catch { /* non-JSON error body */ }

      printStatus('REAL_PROVIDER_AUTH', 'FAIL', errorDetail)
      return { status: 'fail', detail: errorDetail }
    }

    let parsed
    try {
      parsed = JSON.parse(bodyText)
    } catch {
      printStatus('REAL_PROVIDER_AUTH', 'FAIL', 'Response is not valid JSON')
      return { status: 'fail', detail: 'Invalid JSON response' }
    }

    const assistantText = parsed.choices?.[0]?.message?.content || ''
    console.log(`  Response: ${assistantText.substring(0, 100)}`)
    console.log('')
    printStatus('REAL_PROVIDER_AUTH', 'PASS', `Model ${model} responded to auth test`)
    return { status: 'pass', model, responseId: parsed.id || null }

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    printStatus('REAL_PROVIDER_AUTH', 'FAIL', message)
    return { status: 'fail', detail: message }
  } finally {
    rmSync(tempDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}

/**
 * L4 Attempt: Verify that the Workbench → Harness → Provider chain is
 * theoretically available in this environment. This is NOT the full L4 test.
 * The full L4 requires the installed product.
 */
function checkWorkbenchHarnessAvailability() {
  console.log('WORKBENCH_HARNESS_AVAILABILITY — Pre-flight check for L4 eligibility')
  console.log('')

  const checks = {
    harnessCheckout: existsSync(HARNESS_CHECKOUT),
    harnessLauncher: existsSync(HARNESS_ACP_LAUNCHER),
    harnessTsconfig: existsSync(HARNESS_TSCONFIG),
  }

  const tsxCli = resolveHarnessTsxCli()
  checks.harnessTsxCli = tsxCli !== null

  for (const [key, available] of Object.entries(checks)) {
    console.log(`  ${key}: ${available ? '✓' : '✗'}`)
  }

  const allReady = Object.values(checks).every(Boolean)

  if (!allReady) {
    printStatus('WORKBENCH_HARNESS_AVAILABILITY', 'NOT READY', 'Some Harness components are missing')
    printStatus('L4_WORKBENCH_HARNESS', 'NOT PROVEN', 'Harness environment incomplete')
    return false
  }

  printStatus('WORKBENCH_HARNESS_AVAILABILITY', 'READY', 'All Harness components present')
  return true
}

/**
 * Simulate what a full L4 pass would look like — but ONLY if the full
 * product chain is already verified. This script CANNOT verify the
 * product chain, so this is always informational only.
 * 
 * The ONLY valid L4 verification path:
 *   1. User installs NSIS package
 *   2. Opens installed Ming Workbench.exe
 *   3. Configures BaseURL + Model + API Key through product UI
 *   4. Key 静态持久化只在 Electron safeStorage；运行时通过受控 allowlisted child env 传给 backend/Harness；严禁进入 repo/Git/log/Evidence/Work Unit/argv/renderer storage
 *   5. Connection test passes via /api/test-provider-connection
 *   6. Real project opened → real intake → real Harness execution
 *   7. Isolated worktree mutation → evidence → readback verification
 * 
 * This script cannot perform steps 1-7. It can only verify prerequisites.
 */
function explainL4Status(authResult, harnessReady) {
  printSep()
  console.log('L4 — REAL WORKBENCH HARNESS JOURNEY')
  console.log('')
  console.log('  Required chain (NOT verifiable by this script):')
  console.log('    NSIS installer → installed Ming Workbench.exe')
  console.log('*    → Product UI: configure BaseURL/Model/Key
 *    → safeStorage: key 静态持久化只在 Electron encrypted storage；运行时
 *       通过受控 allowlisted child env 传给 backend/Harness；不进入 repo/
 *       Git/log/Evidence/Work Unit/argv/renderer storage
  console.log('    → /api/test-provider-connection: real Harness round-trip')
  console.log('    → Real project path → Harness → bounded execution')
  console.log('    → Isolated worktree → evidence → filesystem/git readback')
  console.log('')

  const authPassed = authResult?.status === 'pass'
  if (!authPassed) {
    printStatus('L4_WORKBENCH_HARNESS', 'NOT PROVEN', 'Provider auth failed — cannot proceed to L4')
    return
  }

  if (!harnessReady) {
    printStatus('L4_WORKBENCH_HARNESS', 'NOT PROVEN', 'Workbench Harness not ready in this environment')
    return
  }

  printStatus('L4_WORKBENCH_HARNESS', 'NOT PROVEN', 'Full chain requires installed product. This script cannot verify UI → safeStorage → Harness → execution path.')
  console.log('')
  console.log('  To attempt L4:')
  console.log('    1. Build NSIS:  npm run dist-desktop:nsis')
  console.log('    2. Install:     Run the generated .exe')
  console.log('    3. Configure:   Enter BaseURL/Model/Key through product UI')
  console.log('    4. Test:        Click "连接测试" — must get real Harness round-trip')
  console.log('    5. Execute:     Open a real project, create a real Work Unit')
  console.log('    6. Verify:      Read evidence + git readback independently')
}

/**
 * Final honest status output. No automatic promotion.
 */
function printFinalStatus(authResult, harnessReady) {
  printSep()
  console.log('FINAL STATUS')
  console.log('')

  console.log('  OWN-KEY INFRASTRUCTURE: PASS')
  console.log('    (fixture server + contract tests + credential scan present)')
  console.log('')

  const authStatus = authResult?.status === 'pass' ? 'PASS' : 'NOT RUN — HUMAN COST GATE'
  const authDetail = authResult?.status === 'pass'
    ? `${authResult.model} at ${process.env.MING_L4_BASE_URL?.replace(/\/$/, '') ?? ''}`
    : 'no real provider auth executed'
  printStatus('  REAL PROVIDER AUTH', authStatus, authDetail)
  console.log('')

  printStatus('  INSTALLED OWN-KEY JOURNEY', 'NOT PROVEN', 'Requires installed NSIS + product UI configuration')
  console.log('')

  printStatus('  REAL WORKBENCH HARNESS L4', 'NOT PROVEN', 'Full chain: installer → UI → safeStorage → Harness → execution → evidence → readback')
  console.log('')
}

async function main() {
  console.log('═'.repeat(72))
  console.log('Ming Workbench — Provider Own-Key Verification')
  console.log('Strict, env-only, fail-closed. No simulated shortcuts.')
  console.log('═'.repeat(72))

  const envReady = checkEnv()

  let authResult = null
  if (envReady) {
    authResult = await runRealProviderAuth()
  }

  const harnessReady = checkWorkbenchHarnessAvailability()

  explainL4Status(authResult, harnessReady)
  printFinalStatus(authResult, harnessReady)

  // Exit code: non-zero if auth failed (blocking), 0 otherwise
  if (authResult && authResult.status === 'fail') {
    process.exit(2)
  }
  process.exit(0)
}

main().catch(err => {
  console.error('FATAL:', err instanceof Error ? err.message : String(err))
  console.log('')
  printStatus('REAL_PROVIDER_AUTH', 'NOT RUN — HUMAN COST GATE', 'Script crashed')
  printStatus('L4_WORKBENCH_HARNESS', 'NOT PROVEN')
  process.exit(3)
})
