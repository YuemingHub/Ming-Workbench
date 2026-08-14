/**
 * Real repository observation for execution authority and evidence.
 *
 * Every bounded execution must re-read the actual Git/working-tree state
 * immediately before and after mutation. Workbench cached state is never
 * trusted as proof of reality. These helpers read the live repository so the
 * execution path can:
 *
 *  - reconcile the current HEAD against the grant's granted base_ref;
 *  - capture a before-state and an after-state;
 * - compute the delta actually produced by THIS execution;
 * - reject changes outside the granted write_target scope;
 * - never count pre-existing dirty files as execution success.
 */

import { execFileSync } from 'node:child_process'
import { isAbsolute, relative, resolve } from 'node:path'

import type { ProviderExecutionGrant } from './provider-grant.js'
import {
  assessRepositoryFrontier,
  type FrontierDecision,
  type RepositoryFrontier,
} from '../domain-packs/repository-frontier.js'

export interface RepositorySnapshot {
  /** Absolute resolved project root. */
  root: string
  /** Current HEAD sha, or '' when the path is not a Git repository. */
  head: string
  isGit: boolean
  /** Current branch name, or '' when detached or HEAD-less. */
  branch: string
  /** Normalized relative paths with uncommitted changes (includes untracked). */
  dirtyFiles: string[]
}

export interface RepositoryDelta {
  /** All currently dirty files after execution (within repo). */
  changedFiles: string[]
  /** Files dirtied during this execution (not dirty before it started). */
  executionProducedChanges: string[]
  /** Files already dirty before execution; never count as execution success. */
  preExistingDirty: string[]
  /** Changed files outside the granted write_target.repository. */
  scopeViolations: string[]
  /** True when HEAD moved between snapshots (a commit happened). */
  headChanged: boolean
}

export interface MutationReconciliation {
  safeToStart: boolean
  reason: string
  frontier: RepositoryFrontier
  decision: FrontierDecision
}

function git(root: string, args: string[]): { out: string; ok: boolean } {
  try {
    const out = execFileSync('git', ['-C', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    return { out, ok: true }
  } catch {
    return { out: '', ok: false }
  }
}

function parsePorcelain(out: string): string[] {
  if (!out) return []
  return out
    .split('\n')
    .map((line) => {
      if (!line) return ''
      // The first two characters are the status code; the path follows,
      // optionally separated by a single space. Git builds differ: tracked
      // modifications emit `XY<path>` (no separator) while untracked emits
      // `?? <path>` (with a space). Handle both so the returned path is exact.
      let rest = line.slice(2)
      if (rest.startsWith(' ')) rest = rest.slice(1)
      return rest
    })
    .filter(Boolean)
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Read the real, current repository state. Never cached. */
export function readRepositorySnapshot(root: string): RepositorySnapshot {
  const abs = resolve(root)
  const headRes = git(abs, ['rev-parse', 'HEAD'])
  const isGit = headRes.ok && headRes.out.length > 0
  const branchRes = isGit ? git(abs, ['branch', '--show-current']) : { out: '', ok: false }
  const dirty = git(abs, ['status', '--porcelain'])
  return {
    root: abs,
    head: isGit ? headRes.out : '',
    isGit,
    branch: branchRes.ok ? branchRes.out : '',
    dirtyFiles: isGit ? parsePorcelain(dirty.out) : [],
  }
}

/**
 * Reconcile the live repository against the granted mutation scope immediately
 * before execution. This is the real pre-mutation frontier check: it reads the
 * actual HEAD, not a stale cached value.
 */
export function reconcileBeforeMutation(
  snapshot: RepositorySnapshot,
  grant: ProviderExecutionGrant,
  intendedFiles: string[] = [],
): MutationReconciliation {
  const target = grant.authorization.write_target
  if (!target) {
    return {
      safeToStart: false,
      reason: 'grant has no write_target; cannot prove a bounded mutation scope.',
      frontier: makeFrontier(snapshot, []),
      decision: failDecision('grant has no write_target'),
    }
  }
  if (!snapshot.isGit) {
    return {
      safeToStart: false,
      reason: 'selected project is not a Git repository; execution requires a Git project.',
      frontier: makeFrontier(snapshot, []),
      decision: failDecision('not a Git repository'),
    }
  }
  if (snapshot.head && target.base_ref && snapshot.head !== target.base_ref) {
    return {
      safeToStart: false,
      reason: `repository HEAD ${snapshot.head} differs from granted base_ref ${target.base_ref}; the grant is stale and must be re-issued.`,
      frontier: makeFrontier(snapshot, []),
      decision: failDecision('HEAD diverged from granted base_ref'),
    }
  }

  const frontier = makeFrontier(snapshot, intendedFiles)
  const decision = assessRepositoryFrontier(frontier, intendedFiles)
  if (!decision.safeToStart) {
    return {
      safeToStart: false,
      reason: decision.reason,
      frontier,
      decision,
    }
  }

  return {
    safeToStart: true,
    reason: `repository HEAD ${snapshot.head} matches granted base_ref ${target.base_ref}.`,
    frontier,
    decision,
  }
}

function makeFrontier(snapshot: RepositorySnapshot, intendedFiles: string[]): RepositoryFrontier {
  // Current uncommitted work is surfaced as one active work item so overlap
  // detection sees it; the intended surface is the explicit grant scope.
  void intendedFiles
  return {
    repository: snapshot.root,
    baseRef: snapshot.head,
    observedAt: new Date().toISOString(),
    activeWork: snapshot.dirtyFiles.length > 0
      ? [
          {
            id: 'local-uncommitted',
            title: 'Uncommitted local changes at execution start',
            kind: 'branch',
            changedFiles: snapshot.dirtyFiles,
          },
        ]
      : [],
  }
}

function failDecision(reason: string): FrontierDecision {
  return {
    kind: 'conflict',
    safeToStart: false,
    conflicts: [],
    occupiedFiles: [],
    reason,
  }
}

/**
 * Compute the delta produced by THIS execution by comparing the before and
 * after repository snapshots.
 *
 * - Pre-existing dirty files are excluded from execution-produced changes.
 * - Any changed file outside the granted repository root is a scope violation.
 * - If HEAD moved, committed files are attributed to this execution.
 */
export function computeExecutionDelta(
  before: RepositorySnapshot,
  after: RepositorySnapshot,
  grantRepoRoot: string,
): RepositoryDelta {
  const grantRoot = resolve(grantRepoRoot)
  const headChanged = before.head !== after.head
  const preDirty = new Set(before.dirtyFiles)
  const executionProducedChanges: string[] = []
  const preExistingDirty: string[] = []
  const scopeViolations: string[] = []

  for (const file of after.dirtyFiles) {
    const abs = resolve(after.root, file)
    if (!isWithin(grantRoot, abs)) {
      scopeViolations.push(file)
      continue
    }
    if (preDirty.has(file)) {
      preExistingDirty.push(file)
    } else {
      executionProducedChanges.push(file)
    }
  }

  if (headChanged && before.head) {
    const committed = git(after.root, [
      'diff',
      '--name-only',
      `${before.head}...${after.head}`,
    ]).out
    // `git diff --name-only` emits bare file paths, not the `XY ` porcelain
    // prefix, so do NOT run it through parsePorcelain (which strips 3 chars).
    for (const file of committed.split('\n').map((s) => s.trim()).filter(Boolean)) {
      if (!executionProducedChanges.includes(file)) executionProducedChanges.push(file)
    }
  }

  return {
    changedFiles: after.dirtyFiles,
    executionProducedChanges,
    preExistingDirty,
    scopeViolations,
    headChanged,
  }
}

export type ExternalEffectStatus = 'success' | 'failure' | 'unknown' | 'reconciling'

export interface ExternalEffectOutcome {
  status: ExternalEffectStatus
  reason: string
  reconciliationEvidence?: string
  retryable: boolean
}

/**
 * Reconcile an external effect against its REAL target. Never blind-retries.
 * Uses `git -C <target>` so it inspects the correct repository even when the
 * Workbench process cwd is unrelated. Synchronous: it is a local readback of
 * the actual repository state, and the caller may `await` it harmlessly.
 */
export function reconcileExternalEffect(
  effectType: string,
  target: string,
  _grant: ProviderExecutionGrant,
): ExternalEffectOutcome {
  if (!['local-git', 'local-file'].includes(effectType)) {
    return {
      status: 'unknown',
      reason: `External effect "${effectType}" requires an explicit reconciliation adapter. Not auto-retried.`,
      retryable: false,
    }
  }

  const res = git(resolve(target), ['status', '--porcelain'])
  if (!res.ok) {
    return {
      status: 'unknown',
      reason: 'Reconciliation failed: target repository is not reachable or not a Git repository.',
      retryable: false,
    }
  }

  if (res.out) {
    return {
      status: 'success',
      reason: 'Reconciliation confirmed: target repository has uncommitted changes.',
      reconciliationEvidence: res.out,
      retryable: false,
    }
  }

  return {
    status: 'failure',
    reason: 'Reconciliation: target repository has no changes.',
    reconciliationEvidence: 'git status clean',
    retryable: false,
  }
}
