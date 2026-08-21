#!/usr/bin/env node

/**
 * P6.3 — provider protocol and intent-fidelity evidence runner.
 *
 * This is deliberately limited to the existing Idea Space synthesis seam.
 * It does not execute a Work Unit and never enters AAOP or Harness. Protocol
 * consumption is measured separately from semantic intent fidelity, which
 * remains a human review decision.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CORPUS_PATH = resolve(ROOT, 'validation', 'p6.3', 'intent-fidelity-corpus.json')
const RESULTS_DIR = resolve(ROOT, 'validation', 'p6.3', 'runs')
const BUILD_INDEX = resolve(ROOT, '.tmp', 'idea', 'index.js')
const FALLBACK_REPLY = '我还在理解你说的这件事，我们再往前说一步就好。'

if (!existsSync(BUILD_INDEX)) throw new Error('missing .tmp/idea/index.js; run npm run build:test first')
const idea = await import(pathToFileURL(BUILD_INDEX).href)
const corpus = JSON.parse(await readFile(CORPUS_PATH, 'utf8'))
if (!Array.isArray(corpus.cases) || corpus.cases.length !== 5) {
  throw new Error('P6.3 requires the unchanged five-case corpus')
}

const providerArg = process.argv.find((arg) => arg.startsWith('--provider='))?.split('=')[1] ?? 'both'
if (!['fixture', 'real', 'both'].includes(providerArg)) throw new Error(`unsupported provider: ${providerArg}`)

const now = () => new Date().toISOString()

function emptyReview() {
  return {
    status: 'HUMAN_REVIEW_REQUIRED',
    reviewer: null,
    intent_fidelity: null,
    captured_real_problem: null,
    understood_implicit_constraints: null,
    avoided_overdesign: null,
    avoided_unauthorized_decisions: null,
    asked_right_confirmation_questions: null,
    correction_count: null,
    invented_decisions_count: null,
    notes: [],
  }
}

function protocolFailure(error, synthesisResult, agreementError) {
  if (error) {
    const message = String(error)
    const kind = /\b401\b/.test(message)
      ? 'provider_authentication'
      : /\b429\b/.test(message)
        ? 'provider_rate_limit'
        : /timeout|timed out|abort/i.test(message)
          ? 'provider_timeout'
          : 'provider_transport'
    return { kind, reason: message }
  }
  if (synthesisResult?.reply === FALLBACK_REPLY) {
    return { kind: 'invalid_json_or_schema', reason: 'provider response remained unconsumable after one bounded recovery' }
  }
  if (agreementError) return { kind: 'invalid_json_or_schema', reason: agreementError }
  return null
}

async function runCase(endpoint, item, providerLabel) {
  let current = idea.beginIdea(idea.createLetterIdea())
  current = idea.chooseEntry(current, item.entry)
  current = idea.appendHumanTurn(current, item.raw_intent)
  let turnsUsed = 1
  let synthesisResult
  let providerError = null

  async function ask() {
    try {
      return await idea.synthesizeTurn(endpoint, current)
    } catch (error) {
      providerError = error instanceof Error ? error.message : String(error)
      return undefined
    }
  }

  synthesisResult = await ask()
  if (!providerError && synthesisResult && !synthesisResult.synthesis) {
    current = {
      ...current,
      turns: [...current.turns, { role: 'workbench', text: synthesisResult.reply, at: now() }],
    }
    current = idea.appendHumanTurn(current, item.follow_up)
    turnsUsed += 1
    synthesisResult = await ask()
  }

  let agreement = null
  let agreementError = null
  if (!providerError && synthesisResult?.synthesis) {
    current = idea.applySynthesis(current, synthesisResult.synthesis, synthesisResult.reply)
    try {
      agreement = await idea.synthesizeAgreement(endpoint, current)
      current = idea.applyAgreement(current, agreement, '这一轮我们这样开始。')
    } catch (error) {
      agreementError = error instanceof Error ? error.message : String(error)
    }
  }

  const protocol = protocolFailure(providerError, synthesisResult, agreementError)
  const intent = protocol || !synthesisResult?.synthesis || !agreement
    ? null
    : { status: 'HUMAN_REVIEW_REQUIRED', reason: 'JSON/schema success is not evidence of intent fidelity' }

  return {
    id: item.id,
    raw_intent: item.raw_intent,
    conversation: current.turns,
    ai_synthesis: synthesisResult?.synthesis ?? null,
    ai_reply: synthesisResult?.reply ?? null,
    ai_agreement: agreement,
    protocol_failure: protocol,
    intent_fidelity_failure: intent,
    execution_correctness: 'NOT_RUN',
    human_review: emptyReview(),
    final_outcome: synthesisResult?.synthesis
      ? { status: 'PROPOSED_NOT_EXECUTED', value: synthesisResult.synthesis.recommendation, verified: false }
      : null,
    provider: providerLabel,
    evidence_boundary: providerLabel === 'real'
      ? 'L1_PROVIDER_COMPONENT_ONLY_UNTIL_HUMAN_REVIEW'
      : 'DETERMINISTIC_FIXTURE_TRANSPORT_BASELINE_ONLY',
    errors: { provider: providerError, agreement: agreementError },
    turns_used: turnsUsed,
    convergence_turns: turnsUsed,
    evaluation_anchors: item.evaluation_anchors,
  }
}

async function runCorpus(endpoint, providerLabel) {
  const cases = []
  for (const item of corpus.cases) cases.push(await runCase(endpoint, item, providerLabel))
  const protocolSuccess = cases.filter((item) => !item.protocol_failure).length
  return {
    provider: providerLabel,
    model: endpoint.model,
    case_count: cases.length,
    protocol_success_count: protocolSuccess,
    protocol_success_rate: `${protocolSuccess}/${cases.length}`,
    intent_fidelity_result: 'HUMAN_REVIEW_REQUIRED',
    human_review_required_count: cases.length,
    human_correction_required_count: null,
    invented_decisions_count: null,
    convergence_turns: cases.map(({ id, convergence_turns }) => ({ id, turns: convergence_turns })),
    cases,
  }
}

function providerFromEnv() {
  const endpoint = {
    baseUrl: process.env.MING_REAL_SYNTHESIS_BASE_URL ?? process.env.MING_L4_BASE_URL ?? process.env.DEEPSEEK_BASE_URL ?? '',
    apiKey: process.env.MING_REAL_SYNTHESIS_API_KEY ?? process.env.MING_L4_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? '',
    model: process.env.MING_REAL_SYNTHESIS_MODEL ?? process.env.MING_L4_MODEL ?? process.env.DEEPSEEK_MODEL ?? '',
  }
  const missing = Object.entries(endpoint).filter(([, value]) => !value).map(([key]) => key)
  const allowed = process.env.MING_REAL_SYNTHESIS_ALLOW === '1' || process.env.MING_L4_ALLOW_PAID === '1'
  return { endpoint, missing, allowed }
}

async function freePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? reject(error) : resolvePort(port))
    })
  })
}

async function startFixture() {
  const port = await freePort()
  const child = spawn(process.execPath, [resolve(ROOT, 'scripts', 'provider-fixture-server.mjs')], {
    cwd: ROOT,
    env: { ...process.env, FIXTURE_PORT: String(port), FIXTURE_API_KEY: 'p63-fixture-key' },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  await new Promise((resolveReady, rejectReady) => {
    let output = ''
    const timer = setTimeout(() => rejectReady(new Error(`fixture did not start: ${output}`)), 10_000)
    child.stdout.on('data', (chunk) => {
      output += String(chunk)
      if (output.includes('provider-fixture ready')) {
        clearTimeout(timer)
        resolveReady()
      }
    })
    child.on('error', rejectReady)
  })
  return {
    endpoint: { baseUrl: `http://127.0.0.1:${port}/v1`, apiKey: 'p63-fixture-key', model: 'fixture-model' },
    close: () => child.kill(),
  }
}

const run = {
  run_id: `p6.3-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  generated_at: now(),
  corpus: 'validation/p6.3/intent-fidelity-corpus.json',
  constraints: { schema_changed: false, aaop_changed: false, harness_changed: false, execution_performed: false },
  providers: {},
}

if (providerArg === 'fixture' || providerArg === 'both') {
  const fixture = await startFixture()
  try {
    run.providers.deterministic = await runCorpus(fixture.endpoint, 'deterministic-fixture')
  } finally {
    fixture.close()
  }
}

if (providerArg === 'real' || providerArg === 'both') {
  const real = providerFromEnv()
  if (!real.allowed) {
    run.providers.real = { provider: 'real', status: 'NOT_RUN_HUMAN_COST_GATE', reason: 'Explicit real-provider gate required', missing: real.missing }
  } else if (real.missing.length > 0) {
    run.providers.real = { provider: 'real', status: 'BLOCKED_MISSING_PROVIDER_CONFIG', reason: 'Provider config incomplete', missing: real.missing }
  } else {
    run.providers.real = await runCorpus(real.endpoint, 'real')
    run.providers.real.status = 'RUN_COMPLETED_HUMAN_REVIEW_REQUIRED'
  }
}

await mkdir(RESULTS_DIR, { recursive: true })
const outputPath = resolve(RESULTS_DIR, `${run.run_id}.json`)
await writeFile(outputPath, `${JSON.stringify(run, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ output: outputPath, providers: Object.fromEntries(Object.entries(run.providers).map(([key, value]) => [key, {
  status: value.status ?? 'RUN_COMPLETED_HUMAN_REVIEW_REQUIRED',
  case_count: value.case_count ?? 0,
  protocol_success_rate: value.protocol_success_rate ?? null,
  intent_fidelity_result: value.intent_fidelity_result ?? null,
  human_correction_required_count: value.human_correction_required_count ?? null,
}])) }, null, 2))
