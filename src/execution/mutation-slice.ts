/**
 * MutationSlice — the exact file boundary of a human-authorized mutation.
 *
 * P0-1 rule: the project root string must NEVER be disguised as an ordinary
 * intended file. A write grant requires one of:
 *
 *   - an exact path surface (grounded intake + explicit human confirmation), or
 *   - an explicit whole-repository authorization (modeled separately).
 *
 * When the path surface is unknown, read-only intake stays allowed but write
 * authorization is refused (fail-closed).
 *
 * The slice is frozen at authorize time: it binds the granted base_ref and the
 * exact paths so that the after-execution repository delta can be checked
 * against the authorized surface.
 */

import { isAbsolute, relative, resolve } from 'node:path'

export type MutationSliceScope =
  | { kind: 'exact'; paths: string[] }
  | { kind: 'unknown' }
  | { kind: 'whole-repository' }

export interface MutationSlice {
  /** Absolute resolved repository root the slice applies to. */
  repository: string
  /** Granted base ref (HEAD SHA at authorize time). */
  baseRef: string
  scope: MutationSliceScope
}

/** Normalize a repo-relative path to forward slashes without a leading ./ */
export function normalizeSlicePath(path: string): string {
  let normalized = path.replaceAll('\\', '/')
  while (normalized.startsWith('./')) normalized = normalized.slice(2)
  return normalized
}

/**
 * Refuse path surfaces that escape the repository. Absolute paths, drive
 * letters, and `..` traversal must never enter a grant's scope.
 */
export function assertSlicePathsWithinRepository(
  repository: string,
  paths: string[],
): void {
  const root = resolve(repository)
  for (const raw of paths) {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new Error('a mutation slice path must be a non-empty string')
    }
    const path = normalizeSlicePath(raw)
    if (
      path.startsWith('/')
      || path === '..'
      || path.startsWith('../')
      || /^[A-Za-z]:/.test(path)
      || path.length === 0
    ) {
      throw new Error(`slice path escapes the repository: ${raw}`)
    }
    // Defense in depth: the resolved path must stay inside the repo root.
    const abs = resolve(root, path)
    const rel = relative(root, abs)
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`slice path escapes the repository: ${raw}`)
    }
  }
}

/** Build an exact-path slice. Throws when the surface is empty or escapes. */
export function buildExactSlice(
  repository: string,
  baseRef: string,
  paths: string[],
): MutationSlice {
  assertSlicePathsWithinRepository(repository, paths)
  const root = resolve(repository)
  // Canonicalize to repo-relative forward-slash paths (collapses interior
  // traversal like a/../b so the frozen surface is unambiguous).
  const unique = [
    ...new Set(
      paths
        .map((p) => relative(root, resolve(root, normalizeSlicePath(p))).replaceAll('\\', '/'))
        .filter(Boolean),
    ),
  ].sort()
  if (unique.length === 0) {
    throw new Error('an exact mutation slice requires at least one path')
  }
  return {
    repository: root,
    baseRef,
    scope: { kind: 'exact', paths: unique },
  }
}

/** Build an explicit whole-repository slice (never a disguised default). */
export function buildWholeRepositorySlice(
  repository: string,
  baseRef: string,
): MutationSlice {
  return {
    repository: resolve(repository),
    baseRef,
    scope: { kind: 'whole-repository' },
  }
}

/** Unknown surface: read-only intake is allowed, write authorization is not. */
export function buildUnknownSlice(repository: string, baseRef: string): MutationSlice {
  return {
    repository: resolve(repository),
    baseRef,
    scope: { kind: 'unknown' },
  }
}

/** Fail-closed: a write grant may never be issued on an unknown surface. */
export function assertSliceAllowsWrite(slice: MutationSlice): void {
  if (slice.scope.kind === 'unknown') {
    throw new Error(
      'write authorization requires a known file surface; the intended paths are unknown (read-only intake is still allowed).',
    )
  }
}

/** True when the repo-relative path is inside the authorized surface. */
export function isPathWithinSlice(slice: MutationSlice, repoRelativePath: string): boolean {
  const path = normalizeSlicePath(repoRelativePath)
  if (slice.scope.kind === 'whole-repository') return true
  if (slice.scope.kind === 'unknown') return false
  return slice.scope.paths.some((candidate) => {
    const dir = normalizeSlicePath(candidate)
    return path === dir || path.startsWith(`${dir}/`)
  })
}

/** Repo-relative changed files that fall OUTSIDE the authorized surface. */
export function findSliceViolations(
  slice: MutationSlice,
  repoRelativePaths: string[],
): string[] {
  return repoRelativePaths.filter((path) => !isPathWithinSlice(slice, path))
}

export function sliceScopeLabel(slice: MutationSlice): string {
  if (slice.scope.kind === 'exact') {
    return `exact(${slice.scope.paths.length} path${slice.scope.paths.length === 1 ? '' : 's'})`
  }
  if (slice.scope.kind === 'whole-repository') return 'whole-repository'
  return 'unknown'
}
