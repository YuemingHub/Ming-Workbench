/**
 * Execution isolation — real repository stays read-only while a bounded run
 * mutates a disposable git worktree, and only the authorized + verified delta
 * is ever applied back.
 *
 * P0-1 re-opened: post-hoc scope detection on the real working tree is not
 * enough. A rogue Harness write that lands outside the granted slice must never
 * touch the Reality Owner's worktree in the first place. This module therefore:
 *
 *   authorized real repo read
 *   → disposable git worktree (detached at the granted base ref)
 *   → Harness workspace-write only inside isolation
 *   → compute exact delta vs the isolation baseline
 *   → MutationSlice verification on the isolated delta
 *   → tests/evidence
 *   → violation = discard isolation (real repo untouched)
 *   → authorized + verified delta only apply back
 *   → authoritative real repo readback
 *
 * The worktree is removed on every path (including failure) so the real
 * repository's metadata never accumulates stale worktrees.
 */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  copyFileSync,
  cpSync,
  unlinkSync,
  mkdirSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'

import {
  readRepositorySnapshot,
  type RepositoryDelta,
  type RepositorySnapshot,
} from './repository.js'
import { isPathWithinSlice, type MutationSlice } from './mutation-slice.js'

export interface ExecutionIsolationOptions {
  /** Absolute path of the REAL repository the human authorized. */
  repository: string
  /** Granted base ref: the exact HEAD SHA frozen at authorize time. */
  baseRef: string
  /** Directory that may host disposable worktrees (defaults to the OS tmpdir). */
  isolationRoot?: string
}

export interface ExecutionIsolation {
  /** Absolute path of the disposable worktree. */
  worktree: string
  /** Absolute path of the real repository (never mutated by the run directly). */
  realRepository: string
  /** The exact ref the worktree was detached at. */
  baseRef: string
}

export interface IsolatedDelta extends RepositoryDelta {
  /** Baseline snapshot taken right after worktree creation. */
  baseline: RepositorySnapshot
  /** Snapshot taken right after execution. */
  after: RepositorySnapshot
}

function git(repository: string, args: string[]): { out: string; ok: boolean } {
  try {
    const out = execFileSync('git', ['-C', repository, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
    return { out, ok: true }
  } catch {
    return { out: '', ok: false }
  }
}

/**
 * Create a disposable worktree detached at the granted base ref. The worktree
 * is the ONLY surface the Harness may mutate; the real repository is never the
 * execution cwd. The path is created under the isolation root so a crash leaves
 * at most an orphaned worktree that `git worktree prune` can reclaim.
 */
export function createExecutionIsolation(
  options: ExecutionIsolationOptions,
): ExecutionIsolation {
  const realRepository = resolve(options.repository)
  const baseRef = options.baseRef.trim()
  if (!baseRef) {
    throw new Error('execution isolation requires a granted base ref')
  }
  const head = git(realRepository, ['rev-parse', 'HEAD'])
  if (!head.ok || head.out !== baseRef) {
    throw new Error(
      `execution isolation requires the real repository HEAD to match the granted base ref (${baseRef}); detected ${head.out || '<no HEAD>'}. Re-authorize against current reality.`,
    )
  }

  const root = resolve(options.isolationRoot ?? tmpdir())
  const worktree = join(root, `mw-isolation-${randomUUID()}`)
  const created = git(realRepository, ['worktree', 'add', '--detach', worktree, baseRef])
  if (!created.ok) {
    throw new Error(
      `failed to create the disposable execution worktree at ${worktree}: ${created.out || 'unknown error'}`,
    )
  }

  return { worktree: resolve(worktree), realRepository, baseRef }
}

/**
 * Remove the disposable worktree and its registration from the real repository.
 * Idempotent; must run on every path including execution failure.
 */
export function discardExecutionIsolation(isolation: ExecutionIsolation): void {
  try {
    git(isolation.realRepository, ['worktree', 'remove', '--force', isolation.worktree])
  } catch {
    // Best-effort: an already-removed worktree is fine.
  }
  // The directory must not survive either (it lives outside the real repo).
  try {
    execFileSync('rm', ['-rf', isolation.worktree], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    // Best-effort cleanup.
  }
}

/**
 * Read the isolation baseline: the disposable worktree's clean state right after
 * creation (detached at the granted base ref). This snapshot is the reference
 * point for "what did THIS run produce".
 */
export function readIsolationBaseline(isolation: ExecutionIsolation): RepositorySnapshot {
  return readRepositorySnapshot(isolation.worktree)
}

/**
 * Compute the delta the run actually produced INSIDE the isolation. The real
 * repository is never read here; both snapshots belong to the disposable
 * worktree, so pre-existing dirty state of the real repo can never be mistaken
 * for run output.
 *
 * Unlike `computeExecutionDelta`, the worktree IS the authorized workspace, so
 * the "is the file inside the repository root" check is always satisfied by
 * construction. Only the MutationSlice surface matters for scope violations.
 */
export function computeIsolatedDelta(
  isolation: ExecutionIsolation,
  slice: MutationSlice,
  baseline: RepositorySnapshot,
): IsolatedDelta {
  const after = readRepositorySnapshot(isolation.worktree)
  const headChanged = baseline.head !== after.head
  const preDirty = new Set(baseline.dirtyFiles)
  const executionProducedChanges: string[] = []
  const preExistingDirty: string[] = []
  const scopeViolations: string[] = []

  for (const file of after.dirtyFiles) {
    if (preDirty.has(file)) {
      preExistingDirty.push(file)
      continue
    }
    // P0-1: files newly dirtied by THIS execution must be a subset of the
    // authorized slice surface.
    if (!isPathWithinSlice(slice, file)) {
      scopeViolations.push(file)
      continue
    }
    executionProducedChanges.push(file)
  }

  if (headChanged && baseline.head) {
    const committed = git(isolation.worktree, [
      'diff',
      '--name-only',
      `${baseline.head}...${after.head}`,
    ]).out
    for (const file of committed.split('\n').map((s) => s.trim()).filter(Boolean)) {
      if (!isPathWithinSlice(slice, file)) {
        if (!scopeViolations.includes(file)) scopeViolations.push(file)
        continue
      }
      if (!executionProducedChanges.includes(file)) executionProducedChanges.push(file)
    }
  }

  return {
    changedFiles: after.dirtyFiles,
    executionProducedChanges,
    preExistingDirty,
    scopeViolations,
    headChanged,
    baseline,
    after,
  }
}

/**
 * Apply ONLY the authorized + verified delta back to the real repository.
 *
 * This is the single write path into the real worktree. It copies exactly the
 * files the run produced inside the granted slice; anything outside the slice
 * has already been rejected and the isolation discarded. Deleted slice files
 * are deleted in the real repository. The real repository HEAD never moves —
 * the applied changes land as uncommitted working-tree changes for the human to
 * review and commit.
 */
export function applyAuthorizedDelta(
  isolation: ExecutionIsolation,
  slice: MutationSlice,
  executionProducedChanges: string[],
): string[] {
  const applied: string[] = []
  for (const file of executionProducedChanges) {
    if (!isPathWithinSlice(slice, file)) continue
    const src = join(isolation.worktree, file)
    const dest = join(isolation.realRepository, file)
    if (existsSync(src)) {
      mkdirSync(dirname(dest), { recursive: true })
      copyFileSync(src, dest)
      try {
        const mode = statSync(src).mode
        if (process.platform !== 'win32') {
          execFileSync('chmod', [String(mode & 0o777), dest], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          })
        }
      } catch {
        // Best-effort permission preservation.
      }
    } else if (existsSync(dest)) {
      // Deleted inside the authorized slice during the run.
      unlinkSync(dest)
    }
    applied.push(file)
  }
  return applied
}

/** True when the path is a linked worktree of the real repository. */
export function assertWorktreeBelongsTo(
  worktree: string,
  realRepository: string,
): void {
  const list = git(realRepository, ['worktree', 'list', '--porcelain'])
  if (!list.ok) {
    throw new Error(`cannot list worktrees of ${realRepository}`)
  }
  const lines = list.out.split('\n')
  const normalized = resolve(worktree)
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith('worktree ') && resolve(lines[i].slice('worktree '.length)) === normalized) {
      return
    }
  }
  throw new Error(`workspace ${worktree} is not a linked worktree of the authorized repository ${realRepository}.`)
}

/**
 * Mirror the real repo's node_modules into the disposable worktree (best
 * effort). The worktree is a clean detached checkout with no dependencies; a
 * real project test needs its installed modules to produce honest evidence.
 * Deliberately NOT a symlink: the Harness must never be able to mutate the real
 * repo's dependency tree through the isolation. Failure to mirror is recorded,
 * not fatal — the isolated test then fails honestly instead of faking green.
 */
export function mirrorDependenciesIntoIsolation(isolation: ExecutionIsolation): boolean {
  const source = join(isolation.realRepository, 'node_modules')
  const dest = join(isolation.worktree, 'node_modules')
  if (!existsSync(source)) return false
  try {
    // dereference=false keeps symlinks as symlinks so a mirrored bin shim never
    // escapes the worktree into the real repo.
    cpSync(source, dest, { recursive: true, dereference: false, force: true })
    return true
  } catch {
    return false
  }
}

