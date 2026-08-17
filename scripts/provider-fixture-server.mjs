#!/usr/bin/env node
/**
 * Repository-owned deterministic OpenAI-compatible provider fixture.
 *
 * Purpose: let CI prove the REAL Workbench/Harness transport (intake ->
 * authorize -> bounded execution -> write tool -> delta -> evidence) without a
 * real provider secret. This is a deterministic local model server, NOT a
 * product path and NOT L4 evidence.
 *
 * Behavior is driven by the REAL scratch file state (the fixture reads the
 * project README), so it is stable across retries and CI runs:
 *   - while README.md still contains "Version: OLD", emit a read tool call
 *     then a write tool call that replaces it with "Version: NEW";
 *   - once README.md contains "Version: NEW", emit a completion text.
 *
 * The real Harness agent loop therefore performs a genuine read -> write ->
 * conclude sequence against the real filesystem, and Workbench's isolation +
 * delta + apply-back machinery is what actually lands the change.
 */

import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const PORT = Number(process.env.FIXTURE_PORT ?? 8000)
const API_KEY = process.env.FIXTURE_API_KEY ?? 'fixture-key'
const OLD_MARK = 'Version: OLD'
const NEW_MARK = 'Version: NEW'
/** Absolute path to the scratch project root the fixture observes. */
const TARGET = process.env.FIXTURE_TARGET_DIR ?? process.cwd()

// The fixture cannot observe the disposable execution worktree directly, so it
// uses a per-process phase machine aligned to the real Harness agent loop:
//   phase 0: emit a read tool call (so fs-observation-policy observes README)
//   phase 1: emit a write tool call that replaces README with the NEW content
//   phase >=2: emit the completion text
// Every Harness request advances or holds the phase based on what the agent
// needs; the phases are chosen so a fresh scratch repo reaches NEW exactly once.
let phase = 0

function readReadme() {
  try {
    if (existsSync(join(TARGET, 'README.md'))) {
      return readFileSync(join(TARGET, 'README.md'), 'utf8')
    }
  } catch {
    // ignore
  }
  return ''
}

const server = createServer((req, res) => {
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    const authorization = req.headers.authorization ?? ''
    if (!authorization.includes(API_KEY)) {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'invalid api key' } }))
      return
    }

    const content = readReadme()
    const thisPhase = phase
    phase += 1
    console.log(`fixture request: phase=${thisPhase} readmeNew=${content.includes(NEW_MARK)}`)

    // Distinguish request kinds by their prompt text so the same fixture serves
    // the whole journey: provider probe, AAOP intake, and bounded execution.
    let parsed = {}
    try { parsed = JSON.parse(body) } catch { /* ignore */ }
    const messages = Array.isArray(parsed.messages) ? parsed.messages : []
    const promptText = messages.map((m) => String(m.content ?? '')).join(' ')
    const isProbe = promptText.includes('只回复') && promptText.includes('不要调用任何工具')
    const isExecution = promptText.includes('AAOP Provider Execution Grant')
    console.log(`fixture request: isProbe=${isProbe} isExecution=${isExecution}`)

    const sseChunk = (payload) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`)
    }
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
    })
    res.flushHeaders()

    if (isProbe) {
      sseChunk({ choices: [{ index: 0, delta: { content: 'OK' }, finish_reason: null }] })
      sseChunk({ choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } })
    } else if (isExecution) {
      if (thisPhase === 0) {
        // Read tool call so fs-observation-policy observes README.md.
        const readArgs = JSON.stringify({ file_path: 'README.md' })
        const rmid = Math.floor(readArgs.length / 2)
        sseChunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'fixture-read', type: 'function', function: { name: 'read', arguments: readArgs.slice(0, rmid) } }] }, finish_reason: null }] })
        sseChunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: readArgs.slice(rmid) } }] }, finish_reason: null }] })
        sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
      } else if (thisPhase === 1) {
        // Write tool call replacing README.md with the NEW content.
        const writeArgs = JSON.stringify({ file_path: 'README.md', content: `# Workbench Reality Test\n\n${NEW_MARK}\n` })
        const wmid = Math.floor(writeArgs.length / 2)
        sseChunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'fixture-write', type: 'function', function: { name: 'write', arguments: writeArgs.slice(0, wmid) } }] }, finish_reason: null }] })
        sseChunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: writeArgs.slice(wmid) } }] }, finish_reason: null }] })
        sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
      } else {
        sseChunk({ choices: [{ index: 0, delta: { content: 'WORKBENCH_REALITY_MUTATION_DONE' }, finish_reason: null }] })
        sseChunk({ choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 5 } })
      }
    } else {
      // AAOP intake coordinator: return the canonical envelope as plain text.
      // The coordinator prompt embeds `"raw_request": "<text>"`; extract that
      // exact value so the Workbench request-match assertion passes.
      let rawRequest = ''
      const match = promptText.match(/"raw_request":\s*"((?:[^"\\]|\\.)*)"/)
      if (match) {
        try { rawRequest = JSON.parse(`"${match[1]}"`) } catch { rawRequest = match[1] }
      }
      const envelope = JSON.stringify({
        schema_version: '1.0',
        generated_at: new Date().toISOString(),
        raw_request: rawRequest,
        situation: 'existing_repository',
        route: 'feature-change',
        route_confidence: 0.9,
        ambiguities: [],
        question_needed: null,
        // Ground the canonical task: the request is to change Version in
        // README.md, which is a real tracked file. Workbench's scope proposal
        // derives candidate paths from this evidence.
        project_evidence_summary: [
          'README.md — repository README containing "Version: OLD" (the request asks to change it to "Version: NEW").',
        ],
        next_action: 'Change the Version line in README.md from OLD to NEW.',
      })
      sseChunk({ choices: [{ index: 0, delta: { content: envelope }, finish_reason: null }] })
      sseChunk({ choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 10 } })
    }
    res.write('data: [DONE]\n\n')
    res.end()
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`provider-fixture ready on http://127.0.0.1:${PORT}/v1 target=${TARGET}`)
})
