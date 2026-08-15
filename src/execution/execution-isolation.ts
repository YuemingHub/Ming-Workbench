/**
 * Execution isolation — real repository stays read-only while a bounded run
 * mutates a fully independent disposable clone, and only the authorized +
 * verified delta is ever applied back.
 *
 * P0-1 re-opened (hardening): two attack surfaces are closed structurally, not
 * by post-hoc detection:
 *
 *   A. Git metadata isolation. A linked git worktree SHARES the real repo's
 *      .git metadata: `git branch` / `git update-ref` / `git tag` / `git config`
 *      executed inside a linked worktree mutate the Reality Owner's repository
 *      directly. The isolation therefore uses a fully independent disposable
 *      clone (`git clone --no-local`): its refs, HEAD, config, tags, index and
 *      working tree are physically separate from the real repository. Nothing a
 *      Harness does with git inside the clone can touch the real repo's metadata.
 *
 *   B. Symlink / junction escape. A symlink planted inside the isolation (or
 *      inherited from a dependency mirror) that points at the real repo or an
 *      external sentinel must never let a write escape. Every file that the
 *      delta verification or the apply-back step inspects is resolved with
 *      `realpath` and must remain inside the isolation root; otherwise it is a
 *      scope violation and the isolation is discarded. The dependency mirror
 *      dereferences symlinks (copies file content, never links) so no escape
 *      path into the real repo is ever created.
 *
 *   C. Cross-platform cleanup. Isolation removal uses only Node filesystem
 *      primitives (rmSync), never a shell `rm -rf`, so Windows packaged runs
 *      clean up reliably. The real repository keeps zero metadata about the
 *      disposable clone (it is not registered as a worktree).
 *
 * Pipeline:
 *
 *   authorized real repo read
 *   → disposable independent clone (detached at the granted base ref)
 *   → Harness workspace-write only inside isolation
 *   → compute exact delta vs the isolation baseline (realpath-verified)
 *   → MutationSlice verification
 *   → tests/evidence
 *   → violation = discard isolation (real repo untouched, no metadata residue)
 *   → authorized + verified delta only apply back
 *   → authoritative real repo readback
 */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  copyFileSync,
  cpSync,
  unlinkSync,
  mkdirSync,
  rmSync,
  realpathSync,
  statSync,
  lstatSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
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
  /** Directory that may host disposable clones (defaults to the OS tmpdir). */
  isolationRoot?: string
}

export interface ExecutionIsolation {
  /** Absolute path of the disposable independent clone. */
  worktree: string
  /** Absolute path of the real repository (never mutated by the run directly). */
  realRepository: string
  /** The exact ref the clone was checked out at (detached). */
  baseRef: string
}

export interface IsolatedDelta extends RepositoryDelta {
  /** Baseline snapshot taken right after clone creation. */
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
 * Create a fully independent disposable clone detached at the granted base ref.
 *
 * `git clone --no-local` copies the real repository's history into a brand-new
 * .git directory: the clone's refs, HEAD, config, tags, index and reflogs are
 * physically separate. A Harness that runs `git branch` / `git update-ref` /
 * `git tag` / `git config` / `git commit` inside the clone can only ever change
 * the clone's own metadata — never the Reality Owner's repository.
 *
 * The origin remote is removed so no `git push` from inside the isolation can
 * ever target the real repository, even if a Harness tries to route a ref back.
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
  const cloned = git(realRepository, ['clone', '--no-local', '--no-checkout', realRepository, worktree])
  if (!cloned.ok) {
    throw new Error(
      `failed to create the disposable isolation clone at ${worktree}: ${cloned.out || 'unknown error'}`,
    )
  }

  // Detach at the granted base ref: the clone's HEAD is pinned, so a later
  // `git checkout -b` / `git commit` inside the isolation never moves a branch
  // ref that could be interpreted as the real repo's branch.
  const checkout = git(worktree, ['checkout', '--detach', baseRef])
  if (!checkout.ok) {
    // Clean up the failed clone before throwing.
    try {
      rmSync(worktree, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {
      // ignore
    }
    throw new Error(
      `failed to detach the isolation clone at ${baseRef}: ${checkout.out || 'unknown error'}`,
    )
  }

  // Remove the origin remote: nothing inside the isolation may push to the real
  // repository, and no stale URL must be readable as a routing target.
  git(worktree, ['remote', 'remove', 'origin'])

  return { worktree: resolve(worktree), realRepository, baseRef }
}

/**
 * Remove the disposable clone. Cross-platform: Node rmSync only (never a shell
 * `rm -rf`), with retries for transient Windows file locks. Because the clone is
 * NOT a linked worktree, the real repository's metadata contains no reference
 * to it — there is no worktree registration to prune.
 */
export function discardExecutionIsolation(isolation: ExecutionIsolation): void {
  try {
    rmSync(isolation.worktree, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // Best-effort: an already-removed directory is fine.
  }
}

/**
 * Read the isolation baseline: the disposable clone's clean state right after
 * creation (detached at the granted base ref). This snapshot is the reference
 * point for "what did THIS run produce".
 */
export function readIsolationBaseline(isolation: ExecutionIsolation): RepositorySnapshot {
  return readRepositorySnapshot(isolation.worktree)
}

/** True when a resolved path stays strictly inside the isolation root. */
export function isInsideIsolation(isolation: ExecutionIsolation, absolutePath: string): boolean {
  const rel = relative(resolve(isolation.worktree), resolve(absolutePath))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Resolve a candidate file path inside the isolation to its REAL on-disk path.
 * Throws when the real path escapes the isolation root (a symlink or junction
 * planted in the isolation that points at the real repo or an external
 * sentinel). This is the enforcement point for the symlink escape attack.
 */
export function resolveIsolationPath(
  isolation: ExecutionIsolation,
  repoRelativePath: string,
): string {
  const candidate = join(isolation.worktree, repoRelativePath)
  if (existsSync(candidate) || lstatSyncOrNull(candidate)) {
    const real = realpathSync(candidate)
    if (!isInsideIsolation(isolation, real)) {
      throw new Error(
        `isolation path escapes the execution sandbox: ${repoRelativePath} resolves to ${real}`,
      )
    }
    return real
  }
  return candidate
}

function lstatSyncOrNull(path: string): ReturnType<typeof lstatSync> | null {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}

/**
 * Compute the delta the run actually produced INSIDE the isolation. The real
 * repository is never read here; both snapshots belong to the disposable
 * clone, so pre-existing dirty state of the real repo can never be mistaken for
 * run output. Symlink escapes are surfaced as scope violations (fail-closed).
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
    // Symlink / junction escape: any file whose real path leaves the isolation
    // root is a hard scope violation, regardless of its slice membership.
    try {
      resolveIsolationPath(isolation, file)
    } catch {
      scopeViolations.push(file)
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
      try {
        resolveIsolationPath(isolation, file)
      } catch {
        if (!scopeViolations.includes(file)) scopeViolations.push(file)
        continue
      }
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
 *
 * Every source file is realpath-verified to stay inside the isolation before it
 * is copied, so a symlink planted by the run can never smuggle content out of
 * the sandbox or back into the real repo.
 */
export function applyAuthorizedDelta(
  isolation: ExecutionIsolation,
  slice: MutationSlice,
  executionProducedChanges: string[],
): string[] {
  const applied: string[] = []
  for (const file of executionProducedChanges) {
    if (!isPathWithinSlice(slice, file)) continue
    // Fail closed on any symlink escape, even inside the authorized slice.
    const src = resolveIsolationPath(isolation, file)
    const dest = join(isolation.realRepository, file)
    if (existsSync(src) && lstatSync(src).isFile()) {
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

/**
 * Mirror the real repo's node_modules into the disposable clone (best effort).
 * Symlinks are DEREFERENCED: file content is copied, links are never recreated,
 * so a dependency that symlinks back to the real repo can never create a write
 * path out of the isolation. Failure to mirror is recorded, not fatal — the
 * isolated test then fails honestly instead of faking green.
 */
export function mirrorDependenciesIntoIsolation(isolation: ExecutionIsolation): boolean {
  const source = join(isolation.realRepository, 'node_modules')
  const dest = join(isolation.worktree, 'node_modules')
  if (!existsSync(source)) return false
  try {
    // dereference=true: resolve symlinks into real file content. A symlink that
    // would point back at the real repo is copied as its resolved content, so no
    // escape link is ever planted in the isolation.
    cpSync(source, dest, { recursive: true, dereference: true, force: true })
    return true
  } catch {
    return false
  }
}
