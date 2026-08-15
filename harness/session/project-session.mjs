#!/usr/bin/env node
// P1-3: read-only Evidence Projection for one canonical Harness Session.
//
// This is NOT a second Harness event log. It reads the durable
// session.jsonl.zstd artifact through the official reviewed Harness
// session-persistence-jsonl format/zstd primitives and prints a compact
// projection (session pointer, event range, revision, digest) to stdout.
//
// Run under the reviewed Harness checkout's tsx CLI so bare
// @deepseek-ai/dsh-* names resolve to their reviewed source:
//   node <harness>/node_modules/tsx/dist/cli.mjs \
//     --tsconfig <harness>/tsconfig.json \
//     harness/session/project-session.mjs \
//     --session-root <root> --cwd <cwd> --session-id <id>
//
// Output: one JSON object on stdout. Non-zero exit + stderr message on failure.

import { createHash } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const NAME = 'ming-workbench-session-projection'

function usage() {
  process.stderr.write(
    `${NAME}: --session-root <root> --cwd <cwd> --session-id <id> (with MING_HARNESS_CHECKOUT set)\n`,
  )
  process.exit(2)
}

const args = process.argv.slice(2)
function flag(name) {
  const i = args.indexOf(name)
  return i === -1 ? undefined : args[i + 1]
}

const sessionRoot = flag('--session-root')
const cwd = flag('--cwd')
const sessionId = flag('--session-id')
const harnessCheckoutRaw = process.env.MING_HARNESS_CHECKOUT

if (!sessionRoot || cwd === undefined || !sessionId || !harnessCheckoutRaw) usage()

const harnessCheckout = fileURLToPath(pathToFileURL(harnessCheckoutRaw).href)
const jsonlSrcDir = `${harnessCheckout}/packages/session/session-persistence-jsonl/src`

// Official reviewed sources are loaded through file URLs so the projection uses
// the same format/zstd primitives as the Harness persistence backend itself.
const { scanZstdFrames, createZstdFrameDecoder } = await import(
  pathToFileURL(`${jsonlSrcDir}/zstd.ts`).href,
)
const { scanLog, logPath } = await import(
  pathToFileURL(`${jsonlSrcDir}/format.ts`).href,
)

const artifactPath = logPath(sessionRoot, cwd, sessionId, 'zstd')

let buffer
let st
try {
  buffer = await readFile(artifactPath)
  st = await stat(artifactPath, { bigint: true })
} catch (error) {
  process.stderr.write(
    `${NAME}: cannot read persisted session artifact ${artifactPath}: ${error.message}\n`,
  )
  process.exit(1)
}

const digest = createHash('sha256').update(buffer).digest('hex')

const { frames } = scanZstdFrames(buffer)
if (frames.length === 0) {
  process.stderr.write(`${NAME}: empty or header-less Zstandard session log: ${artifactPath}\n`)
  process.exit(1)
}

const decoder = createZstdFrameDecoder()
const plaintexts = []
try {
  for (const plaintext of decoder.decode(buffer, frames)) {
    plaintexts.push(Buffer.from(plaintext))
  }
} finally {
  decoder.close()
}

const scan = scanLog(Buffer.concat(plaintexts))
const first = scan.events[0]
const last = scan.events.at(-1)

const projection = {
  session: {
    pointer: {
      sessionRoot,
      cwd,
      sessionId,
      artifactPath,
      artifactRel: relative(sessionRoot, artifactPath),
    },
    header: {
      id: scan.meta.id,
      version: scan.meta.version,
      createdAt: scan.meta.createdAt,
      cwd: scan.meta.cwd,
      parentSession: scan.meta.parentSession,
      seedLength: scan.meta.seedLength,
      origin: scan.meta.origin,
      delegationDepth: scan.meta.delegationDepth,
      agentPreset: scan.meta.agentPreset,
    },
    revision: {
      dev: String(st.dev),
      ino: String(st.ino),
      size: String(st.size),
      mtimeMs: Number(st.mtimeMs),
    },
    digest,
    frames: frames.length,
    committedBytes: scan.committedBytes,
  },
  eventRange: {
    count: scan.events.length,
    firstSeq: first === undefined ? undefined : first.seq,
    lastSeq: last === undefined ? undefined : last.seq,
  },
}

process.stdout.write(`${JSON.stringify(projection)}\n`)
