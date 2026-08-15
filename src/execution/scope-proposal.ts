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
 * When the proposal cannot reliably identify paths, it returns empty and the
 * UI shows a fail-closed message — never a default whole-repository fallback.
 */

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, relative } from 'node:path'

export interface ProposedMutation {
  paths: string[]
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

/**
 * Derive a non-authoritative proposed mutation scope from read-only project
 * understanding. The proposal uses:
 *
 * 1. Git-tracked files that match keywords from the user's request and the
 *    coordinator's next_action / evidence summaries.
 * 2. File path relevance scoring: files whose path or content mentions
 *    keywords from the request are candidates.
 *
 * This is deliberately conservative: if no clear candidates are found, the
 * proposal is empty (fail-closed), NOT a default whole-repository scope.
 */
export function proposeMutationScope(input: ScopeProposalInput): ProposedMutation {
  const { projectRoot, rawRequest, intakeEvidence, nextAction, route } = input

  // Gather all text that describes what the user wants and what the
  // coordinator found.
  const contextText = [rawRequest, nextAction, ...intakeEvidence].join(' ')

  // Extract candidate keywords from the request and context.
  const keywords = extractKeywords(contextText)
  if (keywords.length === 0) {
    return { paths: [], source: 'no-keywords', authoritative: false }
  }

  // Get the list of tracked files in the repository.
  const trackedFiles = listGitTrackedFiles(projectRoot)
  if (trackedFiles.length === 0) {
    return { paths: [], source: 'no-tracked-files', authoritative: false }
  }

  // Score each file by how relevant it is to the extracted keywords.
  const scored = trackedFiles
    .map((file) => ({
      file,
      score: scoreFileRelevance(file, keywords, projectRoot),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)

  // Take the top candidates, capped at a reasonable number for UI display.
  const maxPaths = 12
  const paths = scored.slice(0, maxPaths).map((entry) => entry.file)

  if (paths.length === 0) {
    return { paths: [], source: 'no-matching-files', authoritative: false }
  }

  return {
    paths,
    source: `git-tracked-keyword-match(${keywords.length}-keywords, ${paths.length}-paths)`,
    authoritative: false,
  }
}

/**
 * Extract meaningful keywords from the user request and coordinator context.
 * Filters out common stop words and very short tokens.
 */
function extractKeywords(text: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'must', 'can', 'need', 'this', 'that', 'these',
    'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which',
    'who', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both',
    'and', 'or', 'but', 'not', 'no', 'nor', 'so', 'yet', 'for', 'to', 'of',
    'in', 'on', 'at', 'by', 'with', 'from', 'as', 'into', 'about', 'than',
    'then', 'once', 'here', 'there', 'now', 'just', 'also', 'only', 'up',
    'out', 'if', 'my', 'your', 'his', 'her', 'its', 'our', 'their',
    '把', '的', '了', '在', '是', '我', '你', '他', '她', '它', '们',
    '和', '与', '或', '但', '不', '没', '有', '这', '那', '些', '个',
    '就', '都', '也', '还', '只', '要', '会', '能', '可', '以', '对',
    '为', '到', '从', '向', '给', '让', '使', '被', '把', '将', '该',
    '项目', '工作', '一个', '什么', '怎么', '现在', '可以', '需要',
    '看看', '看看这', '接下来', '应该', '先做', '理解', '首页', '当前',
    '上', '下', '里', '外', '中', '后', '前',
  ])

  // Split on non-alphanumeric/CJK boundaries.
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fff._/-]+/i)
    .filter((token) => {
      if (token.length < 2) return false
      if (stopWords.has(token)) return false
      // Filter pure numbers or version-like strings.
      if (/^\d+(\.\d+)*$/.test(token)) return false
      return true
    })

  // Also extract file-extension-like patterns and path segments.
  const pathTokens = text
    .match(/[a-z0-9_-]+\.(js|mjs|ts|tsx|jsx|json|css|html|md|py|rs|go|java|c|cpp|h)/gi)
    ?? []
  
  // Deduplicate while preserving order.
  const seen = new Set<string>()
  const keywords: string[] = []
  for (const token of [...tokens, ...pathTokens]) {
    const lower = token.toLowerCase()
    if (!seen.has(lower)) {
      seen.add(lower)
      keywords.push(lower)
    }
  }

  return keywords.slice(0, 20)
}

/**
 * List all git-tracked files in the repository root.
 */
function listGitTrackedFiles(projectRoot: string): string[] {
  try {
    const output = execFileSync('git', ['-C', projectRoot, 'ls-files'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    })
    return output
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  } catch {
    return []
  }
}

/**
 * Score a file's relevance to the extracted keywords.
 * Higher score = more relevant.
 */
function scoreFileRelevance(
  file: string,
  keywords: string[],
  projectRoot: string,
): number {
  let score = 0
  const lowerFile = file.toLowerCase()

  // Path segment matching: keywords that appear in the file path.
  let keywordMatchScore = 0
  for (const keyword of keywords) {
    if (lowerFile.includes(keyword)) {
      keywordMatchScore += 3
    }
  }

  // Penalize node_modules, dist, build artifacts.
  if (/node_modules|dist|build|\.workbench|\.tmp|\.aaop/.test(lowerFile)) {
    return 0
  }

  // Content matching: read the file and check if keywords appear in content.
  // This is capped to avoid reading huge files.
  try {
    const fullPath = resolve(projectRoot, file)
    const stat = readFileSync(fullPath)
    if (stat.length <= 100_000) {
      const content = stat.toString('utf8').toLowerCase()
      for (const keyword of keywords) {
        if (content.includes(keyword)) {
          keywordMatchScore += 1
        }
      }
    }
  } catch {
    // File might not exist or be unreadable; path score is still valid.
  }

  // Only apply extension bonuses when there is a positive keyword match.
  // This prevents every .js file from appearing as a candidate.
  if (keywordMatchScore > 0) {
    score = keywordMatchScore
    // Prefer source files over config/build files.
    if (/\.(js|mjs|ts|tsx|jsx|py|rs|go|java|c|cpp)$/.test(lowerFile)) {
      score += 1
    }
    if (/\.(test|spec)\.(js|mjs|ts|tsx)$/.test(lowerFile)) {
      score += 1 // test files are good candidates for paired changes
    }
  }

  return score
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
