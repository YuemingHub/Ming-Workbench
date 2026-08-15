import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

import type { AcceptanceCriterion, WorkUnit } from '../core/model.js'
import type { RepositoryReadback } from './bounded-execution.js'
import { isPathWithinSlice, type MutationSlice } from './mutation-slice.js'
import { readRepositorySnapshot, type RepositorySnapshot } from './repository.js'
import type { VerificationVerdict } from './run-outcome.js'

/**
 * P1-4: Independent Verification — a first-class, durable object.
 *
 * The Independent Verifier re-observes REALITY on its own. It never reads the
 * Executor's natural-language conclusion, "done", test claims, or self-summary
 * as a fact. It only sees the Work Unit intent, the acceptance criterion, the
 * authorized slice, the repository identity, and the subject ExecutionRun id.
 *
 * The verifier itself runs as an `ExecutionRun` with `purpose: 'verification'`
 * (separate run, default read-only, never inherits the executor conclusion).
 * No second runtime/session store/ledger is created.
 *
 * Verdict semantics (fail-closed):
 *   passed       only when the verifier's own real observations satisfy the probe
 *   failed       when a real observation contradicts the expectation
 *   inconclusive when the probe cannot be observed (missing probe, runtime
 *                unavailable, ambiguous result) — NEVER auto-promoted to passed
 *                and NEVER a blind retry signal.
 */

export type VerificationProbeKind =
  | 'file-content-hash'
  | 'file-exists'
  | 'test-run'
  | 'git-delta-within-slice'
  | 'no-mutation'
  | 'no-scope-violation'

export interface VerificationProbe {
  kind: VerificationProbeKind
  /** Repo-relative path (for file/test probes). */
  path?: string
  /** Expected file content hash for file-content-hash probes (probe-owned, not executor-owned). */
  expectedSha256?: string
  /** Test command override (default `npm test`). */
  testCommand?: string[]
}

export interface Verification {
  id: string
  workUnitId: string
  /** The ExecutionRun that performed this verification (purpose='verification'). */
  verifierRunId: string
  /** The ExecutionRun being verified (purpose='execution'). */
  subjectRunId: string
  /** The acceptance criterion this verification addresses. */
  criterionId: string
  verdict: VerificationVerdict
  /** Evidence ids this verification produced (referenced from the Work Unit). */
  evidenceRefs: string[]
  /** Independent observations the verifier made (provenance). */
  observations: string[]
  observedAt: string
}

export interface VerificationObservation {
  /** Human/audit-readable statement of what was independently observed. */
  summary: string
  /** Verdict contribution for this single observation. */
  verdict: VerificationVerdict
  /** Raw evidence detail (hash, output tail, delta) for debugging. */
  detail?: string
}

export interface DeterministicVerificationOptions {
  /** Authoritative Work Unit resolved from the store. */
  workUnit: WorkUnit
  /** The acceptance criterion being verified. */
  criterion: AcceptanceCriterion
  /** The authorized mutation surface (slice). */
  slice: MutationSlice
  /** The subject ExecutionRun to verify. */
  subjectRun: { id: string }
  /** Absolute project directory to re-observe. */
  projectRoot: string
  /** Explicit probes to run; when omitted a sensible default set is used. */
  probes?: VerificationProbe[]
  /** Test command override. */
  testCommand?: string[]
  /** Explicit operator opt-in to allow write mutation (verifier stays read-only by default). */
  allowWrite?: boolean
  now?: string
}

export interface DeterministicVerificationResult {
  verification: Verification
  observations: VerificationObservation[]
  repositoryReadback?: RepositoryReadback
}

/** sha256 hex of a file's bytes (probe-owned reality read). */
export function fileSha256(absPath: string): string {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex')
}

/** Re-observes reality and derives a fail-closed verdict for ONE criterion. */
export function runDeterministicVerification(
  options: DeterministicVerificationOptions,
): DeterministicVerificationResult {
  // The verifier re-reads reality WITHOUT any before-snapshot captured by the
  // executor: it judges the CURRENT working tree against the authorized
  // contract (slice). No executor delta, conclusion, or claim is consulted.
  const observations: VerificationObservation[] = []

  for (const probe of options.probes ?? defaultProbes(options.criterion, options.testCommand)) {
    observations.push(runProbe(probe, options))
  }

  // Fail-closed aggregate: any observation is 'failed' => failed; any
  // 'inconclusive' (and no failure) => inconclusive; all 'passed' => passed.
  const hasFailed = observations.some((o) => o.verdict === 'failed')
  const hasInconclusive = observations.some((o) => o.verdict === 'inconclusive')
  const verdict: VerificationVerdict = hasFailed
    ? 'failed'
    : hasInconclusive
      ? 'inconclusive'
      : 'passed'

  const now = options.now ?? new Date().toISOString()
  return {
    verification: {
      id: `VER-${randomUUID()}`,
      workUnitId: options.workUnit.id,
      verifierRunId: '',
      subjectRunId: options.subjectRun.id,
      criterionId: options.criterion.id,
      verdict,
      evidenceRefs: [],
      observations: observations.map((o) => o.summary),
      observedAt: now,
    },
    observations,
  }
}

function runProbe(
  probe: VerificationProbe,
  options: DeterministicVerificationOptions,
): VerificationObservation {
  switch (probe.kind) {
    case 'file-content-hash': {
      if (!probe.path) {
        return { summary: 'file-content-hash probe missing path', verdict: 'inconclusive' }
      }
      const abs = resolve(options.projectRoot, probe.path)
      if (!isWithin(options.projectRoot, abs) || !existsSync(abs)) {
        return {
          summary: `probe file does not exist: ${probe.path}`,
          verdict: 'inconclusive',
        }
      }
      const actual = fileSha256(abs)
      const expected = probe.expectedSha256
      if (!expected) {
        return {
          summary: `probe file content hash recorded but no expected hash was supplied`,
          verdict: 'inconclusive',
        }
      }
      return actual === expected
        ? { summary: `file ${probe.path} hash matches expected`, verdict: 'passed', detail: actual }
        : {
            summary: `file ${probe.path} hash differs from expected`,
            verdict: 'failed',
            detail: `expected ${expected} actual ${actual}`,
          }
    }

    case 'file-exists': {
      if (!probe.path) {
        return { summary: 'file-exists probe missing path', verdict: 'inconclusive' }
      }
      const abs = resolve(options.projectRoot, probe.path)
      if (!isWithin(options.projectRoot, abs)) {
        return { summary: `file-exists probe escapes repo: ${probe.path}`, verdict: 'inconclusive' }
      }
      return existsSync(abs)
        ? { summary: `file exists: ${probe.path}`, verdict: 'passed' }
        : { summary: `file does not exist: ${probe.path}`, verdict: 'failed' }
    }

    case 'test-run': {
      const result = runProjectTests(options.projectRoot, probe.testCommand ?? options.testCommand)
      return result.passed
        ? { summary: 'project tests passed (verifier-run, independent)', verdict: 'passed' }
        : {
            summary: 'project tests did not pass (verifier-run)',
            verdict: 'failed',
            detail: result.output,
          }
    }

    case 'git-delta-within-slice': {
      // The verifier independently re-observes the CURRENT working tree and
      // asserts every dirty file stays within the authorized slice. It does
      // NOT rely on a before/after delta owned by the executor: reality is
      // judged against the authorized contract, not against who dirtied what.
      const after: RepositorySnapshot = readRepositorySnapshot(options.projectRoot)
      const violations = currentTreeScopeViolations(after, options.slice)
      if (violations.length > 0) {
        return {
          summary: `scope violations observed by verifier: ${violations.join(', ')}`,
          verdict: 'failed',
          detail: violations.join(', '),
        }
      }
      return {
        summary: `delta stays within authorized slice (${after.dirtyFiles.length} dirty files)`,
        verdict: 'passed',
      }
    }

    case 'no-mutation': {
      const after: RepositorySnapshot = readRepositorySnapshot(options.projectRoot)
      const violations = currentTreeScopeViolations(after, options.slice)
      if (violations.length > 0) {
        return {
          summary: `scope violations observed: ${violations.join(', ')}`,
          verdict: 'failed',
        }
      }
      if (after.dirtyFiles.length > 0) {
        return {
          summary: `expected no mutation but observed changes: ${after.dirtyFiles.join(', ')}`,
          verdict: 'failed',
        }
      }
      return { summary: 'no mutation observed (reality unchanged)', verdict: 'passed' }
    }

    case 'no-scope-violation': {
      const after: RepositorySnapshot = readRepositorySnapshot(options.projectRoot)
      const violations = currentTreeScopeViolations(after, options.slice)
      return violations.length === 0
        ? { summary: 'no scope violations observed by verifier', verdict: 'passed' }
        : {
            summary: `scope violations observed: ${violations.join(', ')}`,
            verdict: 'failed',
            detail: violations.join(', '),
          }
    }

    default: {
      return { summary: `unknown probe kind`, verdict: 'inconclusive' }
    }
  }
}

/** Default probe set for a criterion when none is supplied. */
function defaultProbes(
  criterion: AcceptanceCriterion,
  testCommand?: string[],
): VerificationProbe[] {
  const probes: VerificationProbe[] = [
    { kind: 'no-scope-violation' },
    { kind: 'git-delta-within-slice' },
  ]
  if (criterion.statement.toLowerCase().includes('test')) {
    probes.push({ kind: 'test-run', testCommand })
  }
  return probes
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * P1-4: dirty files in the CURRENT working tree that fall OUTSIDE the
 * authorized slice. The verifier judges reality against the authorized
 * contract — it never needs to know who dirtied a file or when, so it does not
 * rely on an executor-owned before/after delta.
 */
function currentTreeScopeViolations(
  snapshot: RepositorySnapshot,
  slice: MutationSlice,
): string[] {
  return snapshot.dirtyFiles.filter((file) => !isPathWithinSlice(slice, file))
}

function runProjectTests(
  projectRoot: string,
  testCommand?: string[],
): { passed: boolean; output: string } {
  const needsShell = testCommand === undefined && process.platform === 'win32'
  const command = testCommand ?? ['npm', 'test']
  const [file, args] = needsShell
    ? [process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm test']]
    : [command[0], command.slice(1)]
  const env = { ...process.env }
  delete env.NODE_TEST_CONTEXT
  try {
    const output = execFileSync(file, args, {
      encoding: 'utf8',
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
      env,
    }).trim()
    return { passed: true, output }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { passed: false, output: `Test execution failed or timed out: ${message}` }
  }
}
