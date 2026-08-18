/**
 * Credential-shaped literal scanner.
 * Runs as CI gate (npm run credential-scan) and can also be used
 * locally before commit. Scans tracked source files for patterns
 * that look like real credentials. Returns non-zero exit code if
 * any credential-shaped literal is found.
 *
 * This is a high-signal scan: it looks for patterns that strongly indicate
 * real credentials (API key assignments, secret literals, auth tokens),
 * not mere hex strings or commit hashes.
 *
 * Usage: node scripts/credential-scan.mjs [--scan-dir <path>]
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execSync } from 'node:child_process'

const REPO_ROOT = resolve(import.meta.dirname, '..')

/**
 * High-confidence credential patterns.
 * Each pattern includes context that makes a credential very likely.
 */
const CREDENTIAL_PATTERNS = [
  {
    name: 'API key with secret prefix',
    regex: /(?:api[_-]?key|apikey|secret[_-]?key|credential)\s*[:=]\s*['"](sk-[a-zA-Z0-9]{10,}|pk-[a-zA-Z0-9]{10,}|rk-[a-zA-Z0-9]{10,})['"]/gi,
  },
  {
    name: 'Authorization Bearer token (real key)',
    regex: /Authorization\s*[:=]\s*['"]Bearer\s+(sk-[a-zA-Z0-9]{10,}|pk-[a-zA-Z0-9]{10,}|rk-[a-zA-Z0-9]{10,})['"]/gi,
  },
  {
    name: 'Hardcoded real key assignment',
    regex: /(?:API_KEY|SECRET_KEY|ACCESS_KEY|PRIVATE_KEY|PROVIDER_KEY)\s*[:=]\s*['"][sk]-[a-zA-Z0-9]{20,}['"]/gi,
  },
  {
    name: 'Vendor key literal (StepFun/Sensetime-style)',
    regex: /(?:MING_)?(?:STEPFUN|SENSENOVA|DEEPSEEK|CUSTOM)[_-]?API[_-]?KEY\s*[:=]\s*['"][a-f0-9]{32,}['"]/gi,
  },
  {
    name: 'Key in object literal',
    regex: /['"](?:sk|pk|rk)-[a-zA-Z0-9]{20,}['"]\s*[,}]/gi,
  },
]

/**
 * Patterns that are known NOT to be credentials and should be excluded.
 */
const EXCLUSION_PATTERNS = [
  // Git commit hashes: bare 40-hex-char strings without credential context
  // These appear in source code as legitimate commit references
  /^[a-f0-9]{40}$/,
  // Test tokens with obviously fake patterns
  /ghp_1234567890/,
  // Python package sha256 hashes in prepare-python-runtime comments
  /sha256:\s*'[a-f0-9]{64}'/,
]

const SKIP_DIRS = ['node_modules', '.git', '.tmp', 'dist-desktop', 'dist', 'p0d-build', '__pycache__', 'docs']

function isTrackedFile(filePath) {
  try {
    const result = execSync(`git ls-files --error-unmatch "${filePath}"`, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    })
    return result.trim().length > 0
  } catch {
    return false
  }
}

function isExcluded(match, line) {
  const matchedText = match[0]
  for (const pattern of EXCLUSION_PATTERNS) {
    if (pattern.test(matchedText)) return true
  }
  // Also check: is this a bare hex string that's just a git reference?
  // If the line mentions "commit", "sha", "hash", "revision" nearby, it's probably not a credential
  const contextStart = Math.max(0, match.index - 50)
  const contextEnd = Math.min(line.length, match.index + 80)
  const context = line.substring(contextStart, contextEnd).toLowerCase()
  if (/commit|sha|hash|revision|reviewed/i.test(context) && /^[a-f0-9]{40}$/i.test(matchedText.trim())) {
    return true
  }
  return false
}

function scanFile(filePath) {
  try {
    const content = readFileSync(filePath, 'utf8')
    const findings = []

    for (const { name, regex } of CREDENTIAL_PATTERNS) {
      regex.lastIndex = 0
      let match
      while ((match = regex.exec(content)) !== null) {
        const lineStart = content.lastIndexOf('\n', match.index) + 1
        const lineEnd = content.indexOf('\n', match.index)
        const line = content.substring(lineStart, lineEnd === -1 ? content.length : lineEnd)
        const lineNum = content.substring(0, match.index).split('\n').length

        if (isExcluded(match, line)) continue

        findings.push({
          pattern: name,
          line: lineNum,
          snippet: line.trim().substring(0, 120),
        })
        if (findings.length >= 10) break
      }
    }

    return findings
  } catch {
    return []
  }
}

function scanDirectory(dir, depth = 0, maxDepth = 8) {
  if (depth > maxDepth) return []
  const findings = []
  try {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (SKIP_DIRS.includes(entry.name)) continue
      if (entry.name.startsWith('.')) continue
      const fullPath = join(dir, entry.name)
      try {
        const stat = statSync(fullPath)
        if (stat.isDirectory()) {
          findings.push(...scanDirectory(fullPath, depth + 1, maxDepth))
        } else if (stat.isFile() && isTrackedFile(fullPath)) {
          const fileFindings = scanFile(fullPath)
          for (const f of fileFindings) {
            findings.push({ file: fullPath, ...f })
          }
        }
      } catch {
        // Skip unreadable
      }
    }
  } catch {
    // Skip unreadable
  }
  return findings
}

function main() {
  const scanDir = process.argv.includes('--scan-dir')
    ? process.argv[process.argv.indexOf('--scan-dir') + 1]
    : REPO_ROOT

  console.log('Credential-shaped literal scan (high-signal)')
  console.log(`Scanning: ${resolve(scanDir)}`)
  console.log(`Patterns: ${CREDENTIAL_PATTERNS.length}`)
  console.log('')

  const findings = scanDirectory(resolve(scanDir))

  if (findings.length === 0) {
    console.log('RESULT: PASS')
    console.log('No credential-shaped literals found in tracked source files.')
    return 0
  }

  console.log('RESULT: FAIL')
  console.log(`\nFound ${findings.length} credential-shaped literal(s):\n`)
  for (const f of findings) {
    console.log(`  File: ${f.file}`)
    console.log(`  Pattern: ${f.pattern}`)
    console.log(`  Line: ${f.line}`)
    console.log(`  Snippet: ${f.snippet}`)
    console.log('')
  }

  console.log('ABORT: Credential-shaped literals detected in tracked source.')
  console.log('Remove the literal and retry. Use environment variables instead.')
  return 1
}

const exitCode = main()
if (exitCode !== 0) process.exit(exitCode)
