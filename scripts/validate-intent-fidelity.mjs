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
    intent_boundary_layers: {
      USER_STATED: [],
      REASONABLE_INFERENCE: [],
      AI_PROPOSAL: [],
      HUMAN_CONFIRMED: [],
    },
    invented_decisions: {
      cadence: null,
      time: null,
      tool: null,
      platform: null,
      resource: null,
      willingness: null,
      priority: null,
      scope: null,
    },
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

function classifySystemPrompt(systemPrompt) {
  const isAgreement = systemPrompt.includes('MING_HUMAN_FIRST_AGREEMENT')
  const isRecovery = systemPrompt.includes('上一次响应无法按约定解析')
  return {
    phase: isAgreement ? 'agreement' : 'synthesis',
    system_prompt_class: isAgreement
      ? (isRecovery ? 'AGREEMENT_FORMAT_RECOVERY' : 'AGREEMENT_ORIGINAL')
      : (isRecovery ? 'TURN_FORMAT_RECOVERY' : 'TURN_ORIGINAL'),
    recovery_used: isRecovery,
  }
}

function createRecordingProvider(endpoint, calls, requestIndexRef) {
  const delegate = idea.createHttpSynthesisProvider(endpoint)
  return {
    async complete(systemPrompt, userContent) {
      const classification = classifySystemPrompt(systemPrompt)
      const record = {
        request_index: ++requestIndexRef.value,
        phase: classification.phase,
        system_prompt_class: classification.system_prompt_class,
        raw_provider_response: null,
        transport_error: null,
        recovery_used: classification.recovery_used,
      }
      try {
        const raw = await delegate.complete(systemPrompt, userContent)
        record.raw_provider_response = raw
        return raw
      } catch (error) {
        record.transport_error = error instanceof Error ? error.message : String(error)
        throw error
      } finally {
        calls.push(record)
      }
    },
  }
}

function phaseProvenance(calls, phase) {
  const phaseCalls = calls.filter((call) => call.phase === phase)
  const first = phaseCalls.find((call) => call.system_prompt_class.endsWith('_ORIGINAL'))
  const recovery = phaseCalls.find((call) => call.recovery_used)
  return {
    first_raw_response: first?.raw_provider_response ?? null,
    recovery_raw_response: recovery?.raw_provider_response ?? null,
    recovery_used: Boolean(recovery),
  }
}

function protocolOutcome({ protocol, calls }) {
  if (protocol) return 'PROTOCOL_FAILURE'
  return calls.some((call) => call.recovery_used)
    ? 'RECOVERED_SUCCESS'
    : 'FIRST_PASS_SUCCESS'
}

async function runCase(endpoint, item, providerLabel, requestIndexRef) {
  let current = idea.beginIdea(idea.createLetterIdea())
  current = idea.chooseEntry(current, item.entry)
  current = idea.appendHumanTurn(current, item.raw_intent)
  let turnsUsed = 1
  let synthesisResult
  let providerError = null
  const providerCalls = []
  const provider = createRecordingProvider(endpoint, providerCalls, requestIndexRef)

  async function ask() {
    try {
      return await idea.synthesizeTurn(undefined, current, provider)
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
      agreement = await idea.synthesizeAgreement(undefined, current, provider)
      current = idea.applyAgreement(current, agreement, '这一轮我们这样开始。')
    } catch (error) {
      agreementError = error instanceof Error ? error.message : String(error)
    }
  }

  const protocol = protocolFailure(providerError, synthesisResult, agreementError)
  const outcome = protocolOutcome({ protocol, calls: providerCalls })
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
    protocol_outcome: outcome,
    provider_provenance: {
      synthesis: phaseProvenance(providerCalls, 'synthesis'),
      agreement: phaseProvenance(providerCalls, 'agreement'),
    },
    provider_calls: providerCalls,
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
  const requestIndexRef = { value: 0 }
  for (const item of corpus.cases) cases.push(await runCase(endpoint, item, providerLabel, requestIndexRef))
  const protocolOutcomes = Object.fromEntries(
    ['FIRST_PASS_SUCCESS', 'RECOVERED_SUCCESS', 'PROTOCOL_FAILURE']
      .map((outcome) => [outcome, cases.filter((item) => item.protocol_outcome === outcome).length]),
  )
  return {
    provider: providerLabel,
    model: endpoint.model,
    case_count: cases.length,
    protocol_outcomes: protocolOutcomes,
    first_pass_protocol_success_count: protocolOutcomes.FIRST_PASS_SUCCESS,
    recovered_protocol_success_count: protocolOutcomes.RECOVERED_SUCCESS,
    protocol_failure_count: protocolOutcomes.PROTOCOL_FAILURE,
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
  protocol_outcomes: value.protocol_outcomes ?? null,
  first_pass_protocol_success_count: value.first_pass_protocol_success_count ?? null,
  recovered_protocol_success_count: value.recovered_protocol_success_count ?? null,
  protocol_failure_count: value.protocol_failure_count ?? null,
  intent_fidelity_result: value.intent_fidelity_result ?? null,
  human_correction_required_count: value.human_correction_required_count ?? null,
}])) }, null, 2))
