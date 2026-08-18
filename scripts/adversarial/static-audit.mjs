#!/usr/bin/env node
/**
 * Adversarial static audit — Outcome Truth & Security lane (Issue #32).
 *
 * Long-running, repeatable, read-only. Binds every conclusion to the exact
 * HEAD SHA that this process runs against, reading source via `git show
 * HEAD:<path>` so a dirty working tree can never be mistaken for the PR head.
 * Never logs real secrets (it never reads them: it only reports on
 * credential-shaped literals inside the repo without echoing their value).
 *
 * Classifies each Issue #32 invariant as PASS / FAIL / PARTIAL / NOT PROVEN.
 * This is a read-only analyzer, not a harness; changing product code to make
 * a check green here is rejected by design.
 *
 * Usage:
 *   node scripts/adversarial/static-audit.mjs [--expect-sha <sha>]
 */

import { execSync } from 'node:child_process'

const ROOT = process.cwd()

const actingHead = execSync('git -C "' + ROOT + '" rev-parse HEAD', {
  encoding: 'utf8',
  stdio: 'pipe',
}).trim()

const TARGET_SHA = (() => {
  const i = process.argv.indexOf('--target-sha')
  return i !== -1 ? process.argv[i + 1] : actingHead
})()

const EXPECT_SHA = (() => {
  const i = process.argv.indexOf('--expect-sha')
  return i !== -1 ? process.argv[i + 1] : undefined
})()

const results = []
function record(id, verdict, summary, evidence) {
  results.push({ id, verdict, summary, evidence: evidence ?? '' })
  console.log(
    `[${verdict}] ${id}: ${summary}${evidence ? `\n      evidence=${evidence}` : ''}`,
  )
}

// ---- exact-target source accessor (never reflects a dirty working tree) ----
function showFull(rel) {
  try {
    return execSync(`git -C "${ROOT}" show "${TARGET_SHA}:${rel.replace(/\\/g, '/')}"`, {
      encoding: 'utf8',
      stdio: 'pipe',
    })
  } catch {
    return null
  }
}

/** Tracked file list at TARGET_SHA (git ls-tree), not the working directory. */
function trackedFiles(prefix) {
  const out = execSync(`git -C "${ROOT}" ls-tree -r --name-only ${TARGET_SHA} -- ${prefix}`, {
    encoding: 'utf8',
    stdio: 'pipe',
  })
  return out.split('\n').map((s) => s.trim()).filter(Boolean)
}

const CREDENTIAL_PATTERNS = [
  /(?:api[_-]?key|apikey|secret[_-]?key|credential)\s*[:=]\s*['"](sk-[a-zA-Z0-9]{10,}|pk-[a-zA-Z0-9]{10,}|rk-[a-zA-Z0-9]{10,})['"]/gi,
  /Authorization\s*[:=]\s*['"]Bearer\s+(sk-[a-zA-Z0-9]{10,}|pk-[a-zA-Z0-9]{10,}|rk-[a-zA-Z0-9]{10,})['"]/gi,
  /(?:API_KEY|SECRET_KEY|ACCESS_KEY|PRIVATE_KEY|PROVIDER_KEY)\s*[:=]\s*['"][sk]-[a-zA-Z0-9]{20,}['"]/gi,
  /(?:MING_)?(?:STEPFUN|SENSENOVA|DEEPSEEK|CUSTOM)[_-]?API[_-]?KEY\s*[:=]\s*['"][a-f0-9]{32,}['"]/gi,
  /['"](?:sk|pk|rk)-[a-zA-Z0-9]{20,}['"]\s*[,}]/gi,
]

// Invariant #10: no credential-shaped literal in tracked source at this SHA.
function secretScan() {
  const files = [
    ...trackedFiles('src'),
    ...trackedFiles('scripts'),
    ...trackedFiles('test'),
    ...trackedFiles('desktop'),
  ]
  const hits = []
  for (const f of files) {
    if (f.endsWith('/static-audit.mjs')) continue
    let content
    try {
      content = showFull(f)
    } catch {
      continue
    }
    if (content === null) continue
    for (const re of CREDENTIAL_PATTERNS) {
      re.lastIndex = 0
      if (re.test(content)) {
        hits.push({ file: f })
        break
      }
    }
  }
  if (hits.length) {
    record(
      'E10-secret-scan',
      'FAIL',
      'credential-shaped literal found in tracked source at HEAD',
      JSON.stringify(hits),
    )
  } else {
    record('E10-secret-scan', 'PASS', 'no credential-shaped literal in tracked source')
  }
}

// Invariant #11: fixture and real-provider evidence are labelled separately.
function fixtureRealSeparation() {
  const slice = showFull('scripts/stage3-first-outcome-slice.mjs')
  const fixture = showFull('scripts/stage3-fixture-server.mjs')
  if (slice === null || fixture === null) {
    record('E11-fixture-real', 'NOT PROVEN', 'stage3 scripts absent at HEAD')
    return
  }
  const notRun = /realPaidProvider\s*[:=]\s*['"]NOT RUN['"]/.test(slice)
  const fixtureIsNotL4 = /NOT\s+L4\s+evidence|not a product path/.test(fixture)
  if (!notRun || !fixtureIsNotL4) {
    record(
      'E11-fixture-real',
      'FAIL',
      'fixture is not separated from a real-provider claim (missing explicit NOT RUN / NOT L4 markers)',
    )
    return
  }
  // The fixture is a deterministic scripted server that emits the exact tool
  // calls + final HTML. So the chain is a transport rehearsal whose content is
  // what the fixture itself decided to write.
  const selfContained =
    /deterministic local model server/.test(fixture) &&
    /emits?.{0,40}tool call/.test(fixture)
  record(
    'E11-fixture-real',
    selfContained ? 'PARTIAL' : 'FAIL',
    selfContained
      ? 'fixture/real separated (REAL PAID PROVIDER: NOT RUN); content fully scripted by deterministic fixture => transport rehearsal, not content truth'
      : 'fixture/real separation present but fixture may not be clearly scripted',
    'transport-only evidence; content not independently verified against intent',
  )
}

// Invariant #12 + false-completed: projection never completes on agent report.
function noFalseCompleted() {
  const p = showFull('src/outcome/project-outcome.ts')
  if (p === null) {
    record('E12-no-false-completed', 'NOT PROVEN', 'project-outcome.ts absent at HEAD')
    return
  }
  const acceptedGate = /acceptance\s*===\s*['"]accepted['"]/.test(p)
  const humanText = /亲自验收/.test(p)
  if (acceptedGate && humanText) {
    record(
      'E12-no-false-completed',
      'PASS',
      'projection returns completed only when verification passed AND acceptance === accepted; otherwise partial/not_proven/failed',
    )
  } else {
    record('E12-no-false-completed', 'PARTIAL', 'projection human gate not fully pinned in source')
  }
}

// Truth preservation: a rejection must not be turned into an optimistic state.
function rejectionPreserved() {
  const p = showFull('src/outcome/project-outcome.ts')
  if (p === null) {
    record('E13-rejection-preserved', 'NOT PROVEN', 'project-outcome.ts absent at HEAD')
    return
  }
  const finalBranch = /if\s*\(outcome\.acceptance\s*===\s*['"]accepted['"]\)/.test(p)
  const elsePartial = /return\s*\{\s*status:\s*['"]partial['"]/.test(p)
  const explicitRejected = /acceptance\s*===\s*['"]rejected['"]/.test(p)
  // deriveRunOutcome only emits rejected paired with verification failed, so
  // today reject->partial is unreachable; independently the pure projection
  // maps passed+rejected to partial (overwrites the rejection).
  if (finalBranch && elsePartial && !explicitRejected) {
    record(
      'E13-rejection-preserved',
      'PARTIAL',
      'projectOutcomeFromRun maps passed+rejected to partial (rejection overwritten); latent — unreachable via deriveRunOutcome today',
    )
  } else {
    record(
      'E13-rejection-preserved',
      'PARTIAL',
      'rejection is not explicitly surfaced in the projection mapping',
    )
  }
}

// Determinism/platform honesty (Issue #32 cases 7/9: crash / close-reopen).
function platformFailClosed() {
  const slice = showFull('scripts/stage3-first-outcome-slice.mjs')
  if (slice === null) {
    record('E14-platform-fail-closed', 'NOT PROVEN', 'slice absent at HEAD')
    return
  }
  const linuxGate = /process\.platform\s*===\s*['"]linux['"]/.test(slice)
  const failOnSkip = /SKIP:/g.test(slice) && /failures\s*\+=\s*1/g.test(slice)
  if (linuxGate && failOnSkip) {
    record(
      'E14-platform-fail-closed',
      'PASS',
      'browser journey fails closed on non-Linux (no xvfb) instead of faking a pass; the advertised determinism is Linux-scoped',
    )
  } else {
    record('E14-platform-fail-closed', 'PARTIAL', 'non-Linux fail-closed behaviour not detected')
  }
}

function summarize() {
  if (EXPECT_SHA && TARGET_SHA !== EXPECT_SHA) {
    record('E00-head-binding', 'FAIL', `TARGET ${TARGET_SHA} != expected ${EXPECT_SHA} (working HEAD=${actingHead})`)
  } else {
    record(
      'E00-head-binding',
      'PASS',
      `audit bound to ${TARGET_SHA} (working HEAD=${actingHead}${actingHead === TARGET_SHA ? '' : ' [drifted]'})`,
    )
  }
  const byVerdict = { PASS: 0, FAIL: 0, PARTIAL: 0, 'NOT PROVEN': 0 }
  for (const r of results) byVerdict[r.verdict]++
  console.log('')
  console.log(
    `SUMMARY TARGET=${TARGET_SHA}  PASS=${byVerdict.PASS} FAIL=${byVerdict.FAIL} PARTIAL=${byVerdict.PARTIAL} NOT_PROVEN=${byVerdict['NOT PROVEN']}`,
  )
  process.exitCode = byVerdict.FAIL ? 1 : 0
}

secretScan()
fixtureRealSeparation()
noFalseCompleted()
rejectionPreserved()
platformFailClosed()
summarize()