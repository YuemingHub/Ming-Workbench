import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { resolveHarnessTsxCli } from '../transports/harness-acp.js'

/**
 * P1-3: Ming Evidence Projection.
 *
 * A Workbench Evidence Projection is a compact, pointer-only projection of ONE
 * canonical Harness Session. It deliberately does NOT copy or re-parse the
 * Harness event log into a second store. The canonical log stays in the Harness
 * durable Session Persistence (session.jsonl.zstd); the projection records just
 * enough to (a) locate the canonical artifact, (b) pin the exact committed
 * event range/revision, (c) fingerprint its bytes, and (d) carry the durable
 * session header facts the Workbench may need for provenance.
 *
 * Reading goes through the reviewed Harness checkout's own
 * session-persistence-jsonl format/zstd primitives (run via the same tsx
 * runner the ACP transport uses), so the projection is derived from official
 * Harness code — it never re-implements the JSONL/zstd format.
 */

export interface SessionPointer {
  sessionRoot: string
  cwd: string
  sessionId: string
  /** Absolute path to the durable canonical artifact. */
  artifactPath: string
  /** Path relative to the session root. */
  artifactRel: string
}

export interface SessionHeaderFacts {
  id: string
  version: number
  createdAt: number
  cwd?: string
  parentSession?: string
  seedLength?: number
  origin?: 'subagent'
  delegationDepth?: number
  agentPreset?: string
}

export interface SessionRevision {
  dev: string
  ino: string
  size: string
  mtimeMs: number
}

export interface EvidenceProjection {
  session: {
    pointer: SessionPointer
    header: SessionHeaderFacts
    revision: SessionRevision
    /** sha256 of the canonical artifact bytes. */
    digest: string
    frames: number
    committedBytes: number
  }
  eventRange: {
    count: number
    firstSeq?: number
    lastSeq?: number
  }
}

export interface SessionEvidenceProjectionInput {
  /** Absolute Ming Workbench checkout containing harness/session/. */
  workbenchRoot: string
  /** Absolute reviewed DeepSeek Harness source checkout. */
  harnessCheckout: string
  /** The durable session root (MING_WORKBENCH_SESSION_ROOT). */
  sessionRoot: string
  /** The session's project working directory. */
  cwd: string
  /** The canonical Harness session id. */
  sessionId: string
}

/**
 * Build the Evidence Projection for one canonical Harness Session.
 *
 * The projection is best-effort in the same sense as the ExecutionFingerprint:
 * an unreachable profile/harness/artifact must never swallow the run record.
 * Returns `undefined` when the session artifact is missing or cannot be
 * projected through the reviewed Harness primitives.
 */
export function buildSessionEvidenceProjection(
  input: SessionEvidenceProjectionInput,
): EvidenceProjection | undefined {
  const workbenchRoot = resolve(input.workbenchRoot)
  const harnessCheckout = resolve(input.harnessCheckout)
  const script = join(workbenchRoot, 'harness', 'session', 'project-session.mjs')
  const tsxCli = resolveHarnessTsxCli(harnessCheckout)
  const harnessTsconfig = join(harnessCheckout, 'tsconfig.json')

  if (!existsSync(script) || !existsSync(tsxCli) || !existsSync(harnessTsconfig)) {
    return undefined
  }

  let stdout: string
  try {
    stdout = execFileSync(
      process.execPath,
      [tsxCli, '--tsconfig', harnessTsconfig, script,
        '--session-root', resolve(input.sessionRoot),
        '--cwd', resolve(input.cwd),
        '--session-id', input.sessionId,
      ],
      {
        env: {
          ...process.env,
          MING_HARNESS_CHECKOUT: harnessCheckout,
        },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
  } catch {
    return undefined
  }

  try {
    const parsed: unknown = JSON.parse(stdout.trim().split('\n')[0] ?? '')
    return validateProjection(parsed)
  } catch {
    return undefined
  }
}

function validateProjection(parsed: unknown): EvidenceProjection | undefined {
  if (typeof parsed !== 'object' || parsed === null) return undefined
  const record = parsed as Record<string, unknown>
  const session = record.session
  if (typeof session !== 'object' || session === null) return undefined
  const s = session as Record<string, unknown>
  const pointer = s.pointer
  const header = s.header
  const revision = s.revision
  const eventRange = record.eventRange
  if (
    typeof pointer !== 'object' || pointer === null
    || typeof header !== 'object' || header === null
    || typeof revision !== 'object' || revision === null
    || typeof eventRange !== 'object' || eventRange === null
  ) {
    return undefined
  }
  const p = pointer as Record<string, unknown>
  const h = header as Record<string, unknown>
  const r = revision as Record<string, unknown>
  const e = eventRange as Record<string, unknown>
  if (
    typeof p.sessionRoot !== 'string'
    || typeof p.cwd !== 'string'
    || typeof p.sessionId !== 'string'
    || typeof p.artifactPath !== 'string'
    || typeof p.artifactRel !== 'string'
    || typeof h.id !== 'string'
    || typeof h.version !== 'number'
    || typeof h.createdAt !== 'number'
    || typeof r.dev !== 'string'
    || typeof r.ino !== 'string'
    || typeof r.size !== 'string'
    || typeof r.mtimeMs !== 'number'
    || typeof s.digest !== 'string'
    || typeof s.frames !== 'number'
    || typeof s.committedBytes !== 'number'
    || typeof e.count !== 'number'
  ) {
    return undefined
  }
  return {
    session: {
      pointer: {
        sessionRoot: p.sessionRoot,
        cwd: p.cwd,
        sessionId: p.sessionId,
        artifactPath: p.artifactPath,
        artifactRel: p.artifactRel,
      },
      header: {
        id: h.id,
        version: h.version,
        createdAt: h.createdAt,
        cwd: typeof h.cwd === 'string' ? h.cwd : undefined,
        parentSession: typeof h.parentSession === 'string' ? h.parentSession : undefined,
        seedLength: typeof h.seedLength === 'number' ? h.seedLength : undefined,
        origin: h.origin === 'subagent' ? 'subagent' : undefined,
        delegationDepth: typeof h.delegationDepth === 'number' ? h.delegationDepth : undefined,
        agentPreset: typeof h.agentPreset === 'string' ? h.agentPreset : undefined,
      },
      revision: {
        dev: r.dev,
        ino: r.ino,
        size: r.size,
        mtimeMs: r.mtimeMs,
      },
      digest: s.digest,
      frames: s.frames,
      committedBytes: s.committedBytes,
    },
    eventRange: {
      count: e.count,
      firstSeq: typeof e.firstSeq === 'number' ? e.firstSeq : undefined,
      lastSeq: typeof e.lastSeq === 'number' ? e.lastSeq : undefined,
    },
  }
}
