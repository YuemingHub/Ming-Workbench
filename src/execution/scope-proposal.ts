/**
 * Workbench product-owned mutation scope proposal.
 *
 * This is a NON-AUTHORITATIVE suggestion derived from read-only project
 * understanding. It is shown to the human for approval. The real authority
 * remains the frozen MutationSlice created by buildExactSlice after human
 * approval.
 *
 * Design constraints:
 * 1. Does NOT belong to AAOP Core.
 * 2. Does NOT belong to Provider Execution Grant.
 * 3. Does NOT change WorkUnit Core completion semantics.
 * 4. It is only a pre-authorization NON-AUTHORITATIVE proposal.
 * 5. Must come from project grounding / read-only understanding.
 * 6. User sees proposal, then approves.
 * 7. Backend uses existing buildExactSlice to validate and freeze.
 * 8. True authority is the authorized MutationSlice.
 *
 * Grounding rule (P0.3): the proposal is NOT a lexical relevance scorer. It
 * never scans all tracked files for keyword matches. It only extracts
 * repo-relative paths that were EXPLICITLY named in one of three grounded
 * sources:
 *
 *   A. AAOP/Harness project_evidence_summary entries
 *   B. the coordinator's next_action
 *   C. the user's own raw request (an exact file path the user typed)
 *
 * Every candidate must be a real tracked path inside the repository, with no
 * traversal, no absolute/drive path, and no protected/build directory. When no
 * grounded explicit path exists, the proposal is empty (fail-closed) and the
 * normal UI keeps execution read-only — never a whole-repository default.
 */

import { execFileSync } from 'node:child_process'

export interface ProposedMutationItem {
  /** Repo-relative forward-slash path. */
  path: string
  /** Short human-facing reason this path was included. */
  reason?: string
}

export interface ProposedMutation {
  items: ProposedMutationItem[]
  source: string
  authoritative: false
}

export interface ScopeProposalInput {
  projectRoot: string
  rawRequest: string
  intakeEvidence: string[]
  nextAction: string
  route: string
}

/** Source extensions we accept as an explicit file path surface. */
const SOURCE_EXTENSION_RE =
  /\.(?:js|mjs|cjs|ts|tsx|jsx|json|css|html|md|py|rs|go|java|c|cpp|h|yml|yaml|sh|ps1|toml|lock)$/i

/** Directories that must never enter a proposed mutation surface. */
const PROTECTED_DIR_RE = /^(?:node_modules|dist|build|\.workbench|\.tmp|\.aaop|\.git)(?:[\\/]|$)/

/**
 * Derive a non-authoritative proposed mutation scope from explicitly grounded
 * repo-relative paths only. No keyword relevance scoring, no full content scan.
 */
export function proposeMutationScope(input: ScopeProposalInput): ProposedMutation {
  const { projectRoot, rawRequest, intakeEvidence, nextAction } = input

  const tracked = listGitTrackedFiles(projectRoot)
  if (tracked.size === 0) {
    return { items: [], source: 'no-tracked-files', authoritative: false }
  }

  const items: ProposedMutationItem[] = []
  const seen = new Set<string>()
  const contributed = new Set<string>()

  // Source A: AAOP/Harness project_evidence_summary explicit paths.
  for (const evidence of intakeEvidence) {
    for (const candidate of extractPathCandidates(evidence)) {
      const path = resolveTrackedPath(candidate, tracked)
      if (path && !seen.has(path)) {
        seen.add(path)
        contributed.add('aaop-evidence')
        items.push({ path, reason: 'AAOP 只读证据中明确指出的实现文件' })
      }
    }
  }

  // Source B: coordinator next_action explicit paths.
  for (const candidate of extractPathCandidates(nextAction)) {
    const path = resolveTrackedPath(candidate, tracked)
    if (path && !seen.has(path)) {
      seen.add(path)
      contributed.add('next-action')
      items.push({ path, reason: '下一步动作中明确指出的文件' })
    }
  }

  // Source C: user raw request explicit exact paths.
  for (const candidate of extractPathCandidates(rawRequest)) {
    const path = resolveTrackedPath(candidate, tracked)
    if (path && !seen.has(path)) {
      seen.add(path)
      contributed.add('user-request')
      items.push({ path, reason: '你在描述中明确给出的文件' })
    }
  }

  if (items.length === 0) {
    return { items: [], source: 'no-explicit-paths', authoritative: false }
  }

  const source = Array.from(contributed).sort().join('+')
  return { items, source, authoritative: false }
}

/**
 * Extract path-like tokens from a text block. A token is a candidate only if it
 * looks like a repo-relative file path (has a source extension, is not
 * absolute, has no traversal, is not inside a protected directory). We do not
 * interpret the text semantically — only explicit path surfaces qualify.
 */
function extractPathCandidates(text: string): string[] {
  if (!text) return []
  const candidates: string[] = []
  // Split on whitespace and common CJK/ASCII punctuation boundaries. Em/en
  // dashes and colons are treated as reason separators, not path characters.
  const segments = text.split(/[\s,，;；、"'`()（）\[\]{}<>]+/).filter(Boolean)
  for (const segment of segments) {
    let token = segment
    // Strip trailing punctuation that can never be part of a path.
    token = token.replace(/[，,；;：:]+$/, '')
    // Split off a trailing human reason joined by an em/en dash.
    const dashIndex = token.search(/[—–]/)
    if (dashIndex > 0) token = token.slice(0, dashIndex)
    if (looksLikeRepoRelativePath(token)) candidates.push(token)
  }
  return candidates
}

function looksLikeRepoRelativePath(token: string): boolean {
  if (!token) return false
  if (!SOURCE_EXTENSION_RE.test(token)) return false
  if (token.startsWith('/') || token.startsWith('\\')) return false
  if (/^[a-zA-Z]:/.test(token)) return false
  if (token.split(/[\\/]/).includes('..')) return false
  if (PROTECTED_DIR_RE.test(token)) return false
  return true
}

/**
 * Resolve a candidate token to a tracked repo-relative path, or undefined if it
 * is not tracked. Normalizes backslashes and strips a leading ./.
 */
function resolveTrackedPath(token: string, tracked: Set<string>): string | undefined {
  const normalized = normalizeProposedPath(token)
  return tracked.has(normalized) ? normalized : undefined
}

/**
 * List all git-tracked files in the repository root as a normalized set.
 */
function listGitTrackedFiles(projectRoot: string): Set<string> {
  try {
    const output = execFileSync('git', ['-C', projectRoot, 'ls-files'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    })
    const tracked = new Set<string>()
    for (const line of output.split('\n')) {
      const trimmed = line.trim()
      if (trimmed.length > 0) tracked.add(normalizeProposedPath(trimmed))
    }
    return tracked
  } catch {
    return new Set()
  }
}

/**
 * Normalize a proposed path to repo-relative forward-slash form.
 * Delegates to the same normalization used by mutation-slice.
 */
export function normalizeProposedPath(path: string): string {
  let normalized = path.replaceAll('\\', '/')
  while (normalized.startsWith('./')) normalized = normalized.slice(2)
  return normalized
}
