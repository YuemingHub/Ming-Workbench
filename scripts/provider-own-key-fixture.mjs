/**
 * Independent fixture server for Provider Contract Test.
 * Simulates an OpenAI-compatible endpoint for deterministic testing.
 * No real credentials used. Runs on port 31001 by default.
 */

import { createServer } from 'node:http'

const PORT = Number(process.env.MING_FIXTURE_PORT) || 31001

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(obj))
}

function okResponse(model, content) {
  return {
    id: `fixture-${Date.now()}`,
    model,
    choices: [{
      message: { role: 'assistant', content },
      finish_reason: 'stop',
      index: 0,
    }],
    usage: { prompt_tokens: 10, completion_tokens: 1, total_tokens: 11 },
  }
}

const server = createServer((req, res) => {
  if (!req.url || req.method !== 'POST') {
    json(res, 404, { error: 'not_found' })
    return
  }

  let body = ''
  req.on('data', chunk => { body += chunk })
  req.on('end', () => {
    const authHeader = req.headers.authorization || ''

    if (req.url === '/health') {
      json(res, 200, { status: 'ok' })
      return
    }

    if (req.url !== '/chat/completions') {
      json(res, 404, { error: 'not_found', path: req.url })
      return
    }

    if (!authHeader.startsWith('Bearer ')) {
      json(res, 401, { error: 'missing_authorization' })
      return
    }

    const token = authHeader.slice(7)

    try {
      const bodyObj = JSON.parse(body || '{}')
      const model = bodyObj.model || 'fixture-model'
      const messages = bodyObj.messages || []
      const lastMessage = messages.length > 0 ? messages[messages.length - 1].content : ''

      if (token === 'INVALID_KEY') {
        json(res, 401, { error: 'invalid_api_key' })
        return
      }

      if (model === 'rate-limit') {
        json(res, 429, { error: 'rate_limit_exceeded', retry_after: 30 })
        return
      }

      if (model === 'server-error') {
        json(res, 500, { error: 'internal_server_error' })
        return
      }

      if (model === 'timeout-simulate') {
        json(res, 504, { error: 'gateway_timeout' })
        return
      }

      if (model === 'malformed-response') {
        res.writeHead(200, { 'Content-Type': 'text/plain' })
        res.end('this is not valid json{{{')
        return
      }

      if (model === 'non-existent-model') {
        json(res, 404, { error: 'model_not_found', model })
        return
      }

      if (!lastMessage || typeof lastMessage !== 'string') {
        json(res, 400, { error: 'bad_request', message: 'No valid user message' })
        return
      }

      json(res, 200, okResponse(model, `Fixture response to: ${lastMessage}`))

    } catch {
      json(res, 400, { error: 'bad_request', message: 'Malformed JSON body' })
    }
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Provider fixture server running on http://127.0.0.1:${PORT}`)
  console.log('Models: test-model, non-existent-model, rate-limit, server-error, timeout-simulate, malformed-response')
})
