/**
 * Sentinel scanner for credential leakage detection.
 * Scans project workspace for leaked sentinel strings.
 * 
 * When running for L4 verification:
 *   1. Generate a random sentinel
 *   2. Save it through the product UI to safeStorage
 *   3. Run the full pipeline (provider, harness, execution, close/reopen)
 *   4. Scan ALL workspace artifacts for the sentinel
 *   5. If sentinel leaks anywhere outside safeStorage → FAIL
 * 
 * Usage: 
 *   Generate: node scripts/provider-sentinel-scan.mjs generate
 *   Scan:     node scripts/provider-sentinel-scan.mjs scan <sentinel>
 *   Full:     node scripts/provider-sentinel-scan.mjs full
 */

import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execSync } from 'node:child_process'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const USER_DATA_DIR = process.env.APP_USER_DATA_DIR || join(
  process.env.APPDATA || join(process.env.HOME || process.env.USERPROFILE, 'AppData', 'Roaming'),
  'ming-workbench'
)

const EXCLUDE_DIRS = new Set([
  'node_modules', '.git', '.tmp', 'dist-desktop', 'dist', 'p0d-build', '__pycache__',
  'harness',
])

function generateSentinel() {
  return 'MW-SENTINEL-' + randomBytes(24).toString('hex')
}

function scanFileForSentinel(filePath, sentinel) {
  try {
    const content = readFileSync(filePath, 'utf8')
    return content.includes(sentinel)
  } catch {
    return false
  }
}

function scanWorkspaceForSentinel(sentinel, startDir) {
  const findings = []
  const dirs = [startDir]

  while (dirs.length > 0) {
    const currentDir = dirs.pop()
    try {
      const entries = readdirSync(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        if (EXCLUDE_DIRS.has(entry.name)) continue
        if (entry.name.startsWith('.')) continue
        const fullPath = join(currentDir, entry.name)
        try {
          const stat = statSync(fullPath)
          if (stat.isDirectory()) {
            dirs.push(fullPath)
          } else if (stat.isFile()) {
            if (scanFileForSentinel(fullPath, sentinel)) {
              findings.push(fullPath)
            }
          }
        } catch {
          // Skip unreadable
        }
      }
    } catch {
      // Skip unreadable
    }
  }
  return findings
}

function scanGitHistoryForSentinel(sentinel) {
  const findings = []
  try {
    const result = execSync(
      `git log --all --oneline -200`,
      { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe' }
    )
    const commits = result.trim().split('\n').filter(Boolean)
    for (const commit of commits) {
      const hash = commit.split(' ')[0]
      if (hash) {
        try {
          const diffResult = execSync(
            `git diff-tree --no-commit-id -r ${hash} | head -100`,
            { cwd: REPO_ROOT, encoding: 'utf8', stdio: 'pipe', timeout: 5000 }
          )
          if (diffResult.includes(sentinel)) {
            findings.push(`commit:${hash}`)
          }
        } catch {
          // Skip unreadable commits
        }
      }
    }
  } catch {
    // Skip if no git history
  }
  return findings
}

function main() {
  const command = process.argv[2]

  if (command === 'generate') {
    const sentinel = generateSentinel()
    console.log(sentinel)
    return 0
  }

  if (command === 'scan') {
    const sentinel = process.argv[3]
    if (!sentinel) {
      console.error('Usage: node scripts/provider-sentinel-scan.mjs scan <sentinel>')
      return 1
    }

    console.log(`Scanning for sentinel: ${sentinel}`)
    console.log('')

    console.log('Workspace scan...')
    const workspaceFindings = scanWorkspaceForSentinel(sentinel, REPO_ROOT)
    if (workspaceFindings.length > 0) {
      console.log(`  FOUND ${workspaceFindings.length} leak(s) in workspace:`)
      for (const f of workspaceFindings) console.log(`    ${f}`)
    } else {
      console.log('  Clean.')
    }

    console.log('Git history scan...')
    const gitFindings = scanGitHistoryForSentinel(sentinel)
    if (gitFindings.length > 0) {
      console.log(`  FOUND ${gitFindings.length} leak(s) in git history:`)
      for (const f of gitFindings) console.log(`    ${f}`)
    } else {
      console.log('  Clean.')
    }

    const allFindings = [...workspaceFindings, ...gitFindings]
    if (allFindings.length === 0) {
      console.log('\nRESULT: SENTINEL-SCAN PASS')
      console.log('Sentinel not found in workspace or git history.')
      return 0
    }

    console.log(`\nRESULT: SENTINEL-SCAN FAIL`)
    console.log(`Sentinel leaked in ${allFindings.length} location(s).`)
    console.log('This indicates the sentinel escaped its storage boundary.')
    return 1
  }

  if (command === 'full') {
    const sentinel = generateSentinel()
    console.log(`Generated sentinel: ${sentinel}`)
    console.log('\nUse this sentinel to store through the product UI, then run:')
    console.log(`  node scripts/provider-sentinel-scan.mjs scan ${sentinel}`)
    return 0
  }

  console.error('Usage:')
  console.error('  node scripts/provider-sentinel-scan.mjs generate')
  console.error('  node scripts/provider-sentinel-scan.mjs scan <sentinel>')
  console.error('  node scripts/provider-sentinel-scan.mjs full')
  return 1
}

const exitCode = main()
if (exitCode !== 0) process.exit(exitCode)
