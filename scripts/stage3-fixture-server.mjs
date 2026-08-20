#!/usr/bin/env node
/**
 * Stage 3 — deterministic OpenAI-compatible provider fixture for the
 * first-real-outcome vertical slice (daily-notes web page).
 *
 * This is a repository-owned deterministic local model server, NOT a product
 * path and NOT L4 evidence. It lets CI prove the REAL Workbench/Harness
 * transport (bridge -> Work Unit -> AAOP intake -> grant -> bounded execution
 * -> write tool -> isolated delta -> verification -> apply-back -> real
 * low-risk artifact) without a real provider secret.
 *
 * The behavior is driven by a per-process phase machine aligned to the real
 * Harness agent loop:
 *   phase 0 (execution): emit a `read` tool call (README.md)
 *   phase 1 (execution): emit a `write` tool call that creates index.html
 *                        with the deterministic daily-notes page
 *   phase >=2 (execution): emit the completion text
 *   intake: emit the canonical AAOP intake envelope that grounds index.html
 *   probe: emit a plain OK
 */

import { createServer } from 'node:http'

const PORT = Number(process.env.FIXTURE_PORT ?? 8001)
const API_KEY = process.env.FIXTURE_API_KEY ?? 'stage3-fixture-key'

export const DAILY_NOTES_HTML = `<!doctype html>
<html lang="zh">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>每日记录</title>
  <style>
    body { font-family: system-ui, "PingFang SC", "Microsoft YaHei", sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; color: #1f2937; }
    h1 { font-size: 1.5rem; }
    .row { display: flex; gap: 0.5rem; }
    input { flex: 1; padding: 0.5rem; font-size: 1rem; border: 1px solid #d1d5db; border-radius: 0.375rem; }
    button { padding: 0.5rem 1rem; font-size: 1rem; border: 0; border-radius: 0.375rem; background: #2563eb; color: #fff; cursor: pointer; }
    button:hover { background: #1d4ed8; }
    ul { list-style: none; padding: 0; }
    li { padding: 0.5rem 0; border-bottom: 1px solid #e5e7eb; }
  </style>
</head>
<body>
  <h1>每日记录</h1>
  <div class="row">
    <input id="entry" type="text" placeholder="今天发生了什么？" autocomplete="off">
    <button id="save" type="button">保存</button>
  </div>
  <ul id="list"></ul>
  <script>
    (function () {
      var KEY = 'daily-notes-stage3'
      function load() {
        try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch (e) { return [] }
      }
      function persist(notes) { localStorage.setItem(KEY, JSON.stringify(notes)) }
      function render() {
        var list = document.getElementById('list')
        list.innerHTML = ''
        load().forEach(function (text) {
          var li = document.createElement('li')
          li.textContent = text
          list.appendChild(li)
        })
      }
      document.getElementById('save').addEventListener('click', function () {
        var input = document.getElementById('entry')
        var text = input.value.trim()
        if (!text) return
        var notes = load()
        notes.push(text)
        persist(notes)
        input.value = ''
        render()
      })
      render()
    })()
  </script>
</body>
</html>
`

let phase = 0

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

    let parsed = {}
    try { parsed = JSON.parse(body) } catch { /* ignore */ }
    const messages = Array.isArray(parsed.messages) ? parsed.messages : []
    const promptText = messages.map((m) => String(m.content ?? '')).join(' ')

    const isProbe = promptText.includes('只回复') && promptText.includes('不要调用任何工具')
    const isExecution = !isProbe && promptText.includes('AAOP Provider Execution Grant')
    const isIntake = promptText.includes('AAOP_CANONICAL_INTAKE_ENVELOPE_OUTPUT_CONTRACT')

    console.log(`fixture request: isProbe=${isProbe} isExecution=${isExecution} isIntake=${isIntake}`)

    const thisPhase = isExecution ? phase : -1
    if (isExecution) phase += 1
    if (isExecution) console.log(`fixture execution phase=${thisPhase}`)

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
        // fs-observation-policy requires reading the WRITE TARGET first; the
        // real agent loop must observe index.html before writing it.
        const readArgs = JSON.stringify({ file_path: 'index.html' })
        sseChunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'stage3-read', type: 'function', function: { name: 'read', arguments: readArgs } }] }, finish_reason: null }] })
        sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
      } else if (thisPhase === 1) {
        // The full arguments string is sent in a single delta so multi-byte
        // UTF-8 content can never be split across chunks and invalidate JSON.
        const writeArgs = JSON.stringify({ file_path: 'index.html', content: DAILY_NOTES_HTML })
        sseChunk({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'stage3-write', type: 'function', function: { name: 'write', arguments: writeArgs } }] }, finish_reason: null }] })
        sseChunk({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] })
      } else {
        sseChunk({ choices: [{ index: 0, delta: { content: 'STAGE3_DAILY_NOTES_DONE' }, finish_reason: null }] })
        sseChunk({ choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 5 } })
      }
    } else if (isIntake) {
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
        project_evidence_summary: [
          'index.html — 当前仓库中仅有的页面占位文件（每日记录网页的执行目标：把它做成能输入一句话、点保存记下来、刷新后还在、关闭后重新打开也还在的本机网页）。',
        ],
        next_action: 'Implement the daily-notes page in index.html.',
      })
      sseChunk({ choices: [{ index: 0, delta: { content: envelope }, finish_reason: null }] })
      sseChunk({ choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 10 } })
    } else {
      sseChunk({ choices: [{ index: 0, delta: { content: 'UNKNOWN_REQUEST' }, finish_reason: null }] })
      sseChunk({ choices: [{ index: 0, delta: { content: '' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } })
    }
    res.write('data: [DONE]\n\n')
    res.end()
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`stage3-fixture ready on http://127.0.0.1:${PORT}/v1`)
})
