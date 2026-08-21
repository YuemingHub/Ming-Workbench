#!/usr/bin/env node
/**
 * P6.3 — Real LLM Intent Synthesis Validation.
 *
 * This runner exercises the existing Idea Space provider seam only:
 *   ordinary-language turns -> synthesizeTurn -> synthesizeAgreement
 *
 * It deliberately does not execute a Work Unit. The `final_outcome` recorded
 * here is the proposed smallest complete outcome, not Outcome Truth. Human
 * review remains required for every case.
 *
 * Providers:
 *   --provider=fixture  Reuses scripts/provider-fixture-server.mjs. This is a
 *                       deterministic transport baseline, never real evidence.
 *   --provider=real    Uses the existing HTTP provider path with env-only
 *                       credentials and an explicit cost gate.
 *   --provider=both    Runs fixture, then real when the real gate is present.
 *
 * Real provider env (no secrets are written to results):
 *   MING_REAL_SYNTHESIS_ALLOW=1
 *   MING_REAL_SYNTHESIS_API_KEY (or MING_L4_API_KEY / DEEPSEEK_API_KEY)
 *   MING_REAL_SYNTHESIS_BASE_URL (or MING_L4_BASE_URL / DEEPSEEK_BASE_URL)
 *   MING_REAL_SYNTHESIS_MODEL (or MING_L4_MODEL / DEEPSEEK_MODEL)
 */

import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CORPUS_PATH = resolve(REPO_ROOT, 'validation', 'p6.3', 'intent-fidelity-corpus.json')
const RESULTS_DIR = resolve(REPO_ROOT, 'validation', 'p6.3', 'runs')
const BUILD_INDEX = resolve(REPO_ROOT, '.tmp', 'idea', 'index.js')
const SYNTHESIS_FALLBACK_REPLY = '我还在理解你说的这件事，我们再往前说一步就好。'

const {
  appendHumanTurn,
  applyAgreement,
  applySynthesis,
  beginIdea,
  chooseEntry,
  createLetterIdea,
  synthesizeAgreement,
  synthesizeTurn,
} = await loadIdeaModule()

const providerArg = process.argv.find((arg) => arg.startsWith('--provider='))?.split('=')[1] ?? 'both'
if (!['fixture', 'real', 'both'].includes(providerArg)) {
  throw new Error(`unsupported --provider=${providerArg}; use fixture, real, or both`)
}

const corpus = JSON.parse(await readFile(CORPUS_PATH, 'utf8'))
if (!Array.isArray(corpus.cases) || corpus.cases.length > 5) {
  throw new Error('P6.3 corpus must contain between 1 and 5 cases')
}

function now() {
  return new Date().toISOString()
}

function providerFromEnv() {
  const endpoint = {
    baseUrl: process.env.MING_REAL_SYNTHESIS_BASE_URL
      ?? process.env.MING_L4_BASE_URL
      ?? process.env.DEEPSEEK_BASE_URL
      ?? '',
    apiKey: process.env.MING_REAL_SYNTHESIS_API_KEY
      ?? process.env.MING_L4_API_KEY
      ?? process.env.DEEPSEEK_API_KEY
      ?? '',
    model: process.env.MING_REAL_SYNTHESIS_MODEL
      ?? process.env.MING_L4_MODEL
      ?? process.env.DEEPSEEK_MODEL
      ?? '',
  }
  const missing = Object.entries(endpoint).filter(([, value]) => !value).map(([key]) => key)
  const allowed = process.env.MING_REAL_SYNTHESIS_ALLOW === '1'
    || process.env.MING_L4_ALLOW_PAID === '1'
  return { endpoint, missing, allowed }
}

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
    notes: [],
  }
}

function classifyFailure({ providerError, synthesisResult, agreementError, turnsUsed }) {
  if (providerError) {
    if (/\b429\b/.test(providerError)) {
      return { category: 'A', reason: 'provider rate-limited the request; semantic synthesis was not evaluated' }
    }
    if (/\b401\b/.test(providerError)) {
      return { category: 'A', reason: 'provider authentication failed; semantic synthesis was not evaluated' }
    }
    return { category: 'A', reason: 'provider/model request failed before usable synthesis' }
  }
  if (synthesisResult?.reply === SYNTHESIS_FALLBACK_REPLY) {
    return { category: 'A', reason: 'provider/model response was not usable under the existing synthesis JSON contract' }
  }
  if (agreementError && synthesisResult?.synthesis) {
    return { category: 'B', reason: 'synthesis existed but agreement contract was unusable' }
  }
  if (synthesisResult && synthesisResult.ready && !synthesisResult.synthesis) {
    return { category: 'B', reason: 'provider marked ready without the required synthesis payload' }
  }
  if (!synthesisResult?.synthesis && turnsUsed > 1) {
    return { category: 'C', reason: 'ordinary input still needs more context after the allowed follow-up' }
  }
  return { category: 'none', reason: 'usable synthesis and agreement returned' }
}

async function runCase(endpoint, item, providerLabel) {
  let idea = beginIdea(createLetterIdea())
  idea = chooseEntry(idea, item.entry)
  idea = appendHumanTurn(idea, item.raw_intent)
  let synthesisResult
  let providerError = null
  let turnsUsed = 1

  async function ask() {
    try {
      return await synthesizeTurn(endpoint, idea)
    } catch (error) {
      providerError = error instanceof Error ? error.message : String(error)
      return undefined
    }
  }

  synthesisResult = await ask()
  if (synthesisResult && !synthesisResult.synthesis && item.follow_up && !providerError) {
    idea = {
      ...idea,
      turns: [...idea.turns, { role: 'workbench', text: synthesisResult.reply, at: now() }],
    }
    idea = appendHumanTurn(idea, item.follow_up)
    turnsUsed += 1
    synthesisResult = await ask()
  }

  let agreement = null
  let agreementError = null
  if (synthesisResult?.synthesis) {
    idea = applySynthesis(idea, synthesisResult.synthesis, synthesisResult.reply)
    try {
      agreement = await synthesizeAgreement(endpoint, idea)
      idea = applyAgreement(idea, agreement, '这一轮我们这样开始。')
    } catch (error) {
      agreementError = error instanceof Error ? error.message : String(error)
    }
  }

  const failure = classifyFailure({ providerError, synthesisResult, agreementError, turnsUsed })
  return {
    id: item.id,
    raw_intent: item.raw_intent,
    conversation: idea.turns,
    ai_synthesis: synthesisResult?.synthesis ?? null,
    ai_reply: synthesisResult?.reply ?? null,
    ai_agreement: agreement,
    human_review: emptyReview(),
    final_outcome: synthesisResult?.synthesis
      ? {
          status: 'PROPOSED_NOT_EXECUTED',
          value: synthesisResult.synthesis.recommendation,
          verified: false,
          note: 'P6.3 验证 synthesis，不执行 Work Unit；Outcome Truth 尚未产生。',
        }
      : null,
    correction_count: null,
    failure_category: failure.category,
    failure_reason: failure.reason,
    provider: providerLabel,
    evidence_boundary: providerLabel === 'real'
      ? 'L1_PROVIDER_COMPONENT_ONLY_UNTIL_HUMAN_REVIEW'
      : 'DETERMINISTIC_FIXTURE_TRANSPORT_BASELINE_ONLY',
    errors: { provider: providerError, agreement: agreementError },
    turns_used: turnsUsed,
    evaluation_anchors: item.evaluation_anchors,
  }
}

async function runCorpus(endpoint, providerLabel) {
  const cases = []
  for (const item of corpus.cases) {
    cases.push(await runCase(endpoint, item, providerLabel))
  }
  const usable = cases.filter((item) => item.ai_synthesis && item.ai_agreement).length
  const failures = cases.filter((item) => item.failure_category !== 'none').length
  return {
    provider: providerLabel,
    model: providerLabel === 'real' ? endpoint.model : 'fixture-model',
    case_count: cases.length,
    usable_synthesis_count: usable,
    failure_count: failures,
    human_review_required_count: cases.length,
    cases,
  }
}

async function startFixture() {
  const port = await findFreePort()
  const child = spawn(process.execPath, [resolve(REPO_ROOT, 'scripts', 'provider-fixture-server.mjs')], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      FIXTURE_PORT: String(port),
      FIXTURE_API_KEY: 'p63-fixture-key',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  await new Promise((resolvePromise, rejectPromise) => {
    let output = ''
    const timeout = setTimeout(() => rejectPromise(new Error(`fixture did not start: ${output}`)), 10_000)
    child.stdout.on('data', (chunk) => {
      output += String(chunk)
      if (output.includes('provider-fixture ready')) {
        clearTimeout(timeout)
        resolvePromise()
      }
    })
    child.on('error', (error) => {
      clearTimeout(timeout)
      rejectPromise(error)
    })
    child.on('exit', (code) => {
      if (code !== null && code !== 0) {
        clearTimeout(timeout)
        rejectPromise(new Error(`fixture exited with ${code}: ${output}`))
      }
    })
  })
  return {
    endpoint: {
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: 'p63-fixture-key',
      model: 'fixture-model',
    },
    close: () => child.kill(),
  }
}

async function findFreePort() {
  return await new Promise((resolvePromise, rejectPromise) => {
    const server = createServer()
    server.once('error', rejectPromise)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : 0
      server.close((error) => error ? rejectPromise(error) : resolvePromise(port))
    })
  })
}

async function loadIdeaModule() {
  if (!existsSync(BUILD_INDEX)) {
    throw new Error('missing .tmp/idea/index.js; run `npm run build:test` first')
  }
  return await import(pathToFileURL(BUILD_INDEX).href)
}

const run = {
  run_id: `p6.3-${new Date().toISOString().replace(/[:.]/g, '-')}`,
  generated_at: now(),
  corpus: 'validation/p6.3/intent-fidelity-corpus.json',
  constraints: {
    schema_changed: false,
    aaop_changed: false,
    harness_changed: false,
    new_agent_or_workflow: false,
    execution_performed: false,
  },
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
    run.providers.real = {
      provider: 'real',
      status: 'NOT_RUN_HUMAN_COST_GATE',
      reason: 'Set MING_REAL_SYNTHESIS_ALLOW=1 (or MING_L4_ALLOW_PAID=1) explicitly before paid/external calls.',
      missing: real.missing,
    }
  } else if (real.missing.length > 0) {
    run.providers.real = {
      provider: 'real',
      status: 'BLOCKED_MISSING_PROVIDER_CONFIG',
      reason: 'Explicit real-provider gate was present but endpoint configuration was incomplete.',
      missing: real.missing,
    }
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
  usable_synthesis_count: value.usable_synthesis_count ?? 0,
  failure_count: value.failure_count ?? 0,
  human_review_required_count: value.human_review_required_count ?? 0,
}])) }, null, 2))
