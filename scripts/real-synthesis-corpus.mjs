#!/usr/bin/env node
/**
 * Real synthesis provider validation — corpus driver.
 *
 * Runs the Workbench Outcome stage (synthesizeTurn + synthesizeAgreement) with
 * a REAL OpenAI-compatible provider on 3-5 non-technical fuzzy human intents,
 * then feeds each confirmed idea through the same closed loop used by corpus
 * 001/002 (execution still doubled — this validation isolates the synthesis
 * variable; the real Harness transport is a separate step).
 *
 * Credentials come ONLY from the environment:
 *   MING_SYNTHESIS_BASE_URL  e.g. https://v2.aicodee.com/v1
 *   MING_SYNTHESIS_API_KEY   the bearer key
 *   MING_SYNTHESIS_MODEL     e.g. MiniMax-M3
 *
 * Results are saved to validation/real-synthesis-corpus/run/<timestamp>/:
 *   case-<id>.json   raw intent turns, provider replies, synthesis, agreement,
 *                    and the closed-loop outcome per case
 *   summary.json     machine-readable summary of the whole run
 *   raw-intents.md   the corpus in human-readable form for evaluation
 */
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, cpSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  beginIdea,
  chooseEntry,
  createLetterIdea,
  confirmIdea,
  appendHumanTurn,
  applySynthesis,
  applyAgreement,
  synthesizeTurn,
  synthesizeAgreementRaw,
} from '../.tmp/idea/index.js'
import { runFirstClosedLoop } from '../.tmp/execution/first-closed-loop.js'
import { createCoordinatorDouble, createGrantRunDouble } from '../test/fixtures/harness-doubles.mjs'
import { CORPUS } from '../validation/real-synthesis-corpus/corpus.mjs'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const bridgeFixture = fileURLToPath(new URL('../test/fixtures/aaop-bridge-fixture.mjs', import.meta.url))
const runDir = join(repoRoot, 'validation', 'real-synthesis-corpus', 'run', new Date().toISOString().replace(/[:.]/g, '-'))
mkdirSync(runDir, { recursive: true })

const baseUrl = process.env.MING_SYNTHESIS_BASE_URL
const apiKey = process.env.MING_SYNTHESIS_API_KEY
const model = process.env.MING_SYNTHESIS_MODEL
if (!baseUrl || !apiKey || !model) {
  console.error('Set MING_SYNTHESIS_BASE_URL, MING_SYNTHESIS_API_KEY, MING_SYNTHESIS_MODEL in the environment.')
  process.exit(2)
}

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function createScratchProject(caseId) {
  const cwd = mkdtempSync(join(tmpdir(), `ming-real-synthesis-${caseId}-`))
  git(cwd, ['init'])
  git(cwd, ['config', 'user.email', 'reality@local.test'])
  git(cwd, ['config', 'user.name', 'Reality'])
  writeFileSync(join(cwd, 'README.md'), `# ${caseId}\n\nA place for one smallest complete real outcome.\n`)
  // The artifact target starts as a placeholder; the loop replaces it with the
  // real self-contained tool for this case.
  writeFileSync(join(cwd, `${caseId}.html`), '<!-- placeholder -->\n')
  git(cwd, ['add', '.'])
  git(cwd, ['commit', '-qm', 'init: placeholder'])
  writeFileSync(
    join(cwd, 'workbench.project.json'),
    JSON.stringify({
      schema_version: '1.0',
      project: { id: caseId, title: caseId, domain_pack: 'development-aaop' },
      development: {
        aaop_bridge: {
          ready: { command: 'node', args: [bridgeFixture, 'ready', '.'] },
          status: { command: 'node', args: [bridgeFixture, 'status', '.'] },
          prompt: { command: 'node', args: [bridgeFixture, 'prompt'] },
        },
      },
    }),
  )
  return cwd
}

const ATTEMPTS_PER_CASE = 3

async function runCase(c, attempt) {
  const record = {
    caseId: c.id,
    attempt,
    title: c.title,
    entry: c.entry,
    rawIntents: c.turns,
    provider: { baseUrl, model },
    startedAt: new Date().toISOString(),
  }

  let idea = createLetterIdea('2026-08-21T09:00:00.000Z')
  idea = beginIdea(idea)
  idea = chooseEntry(idea, c.entry, '2026-08-21T09:00:00.001Z')

  // Conversation: each human turn is followed by a real synthesizeTurn call.
  const turnResults = []
  for (let i = 0; i < c.turns.length; i++) {
    idea = appendHumanTurn(idea, c.turns[i], `2026-08-21T09:00:0${i + 2}.000Z`)
    try {
      const result = await synthesizeTurn({ baseUrl, apiKey, model }, idea)
      turnResults.push({
        afterHumanTurn: i + 1,
        ready: result.ready,
        reply: result.reply,
        rawContent: result.rawContent ?? null,
        synthesis: result.synthesis ?? null,
      })
      if (result.ready && result.synthesis) {
        idea = applySynthesis(idea, result.synthesis, result.reply, `2026-08-21T09:00:0${i + 3}.000Z`)
        record.synthesisFromTurn = i + 1
        break
      }
    } catch (err) {
      record.providerError = err instanceof Error ? err.message : String(err)
      record.turnResults = turnResults
      return { record, idea: null }
    }
  }
  record.turnResults = turnResults

  if (!idea.synthesis) {
    record.notReady = true
    record.synthesis = null
    return { record, idea: null }
  }
  record.synthesis = idea.synthesis

  // Round agreement.
  try {
    const { agreement, rawContent } = await synthesizeAgreementRaw({ baseUrl, apiKey, model }, idea)
    record.agreement = agreement
    record.agreementRawContent = rawContent
    idea = applyAgreement(idea, agreement, '就这样', '2026-08-21T09:00:00.040Z')
    idea = confirmIdea(idea, '2026-08-21T09:00:00.045Z')
  } catch (err) {
    record.agreementError = err instanceof Error ? err.message : String(err)
    record.agreement = null
    return { record, idea: null }
  }

  // Closed loop — execution still doubled; only synthesis is real.
  const projectRoot = createScratchProject(c.id)
  try {
    const result = await runFirstClosedLoop({
      idea,
      project: { projectRoot, trustedProject: true },
      harnessCheckout: mkdtempSync(join(tmpdir(), `ming-harness-dummy-${c.id}-`)),
      workbenchRoot: repoRoot,
      authorizedFile: `${c.id}.html`,
      dependencies: {
        runCoordinator: createCoordinatorDouble({
          situation: 'idea',
          route: 'idea-to-build',
          route_confidence: 0.85,
          project_evidence_summary: [`${c.id}.html — 占位空文件，最小结果将在此创建一个${c.title}的单页工具`],
          next_action: `Authorize a bounded creation of ${c.id}.html — a self-contained page that ${c.id.replace(/-/g, ' ')}.`,
        }),
        runHarnessAcpGrant: createGrantRunDouble({ targetFile: `${c.id}.html`, newContent: c.toolContent() }),
      },
    })
    record.loop = {
      status: result.status,
      ...(result.status === 'completed'
        ? {
            intakeRawRequest: result.executionRun.intakeEnvelope.raw_request,
            situation: result.executionRun.intakeEnvelope.situation,
            route: result.executionRun.intakeEnvelope.route,
            runOutcome: result.executionRun.execution.runOutcome,
            workUnitState: result.executionRun.execution.workUnit.state,
            artifactApplied:
              readFileSync(join(projectRoot, `${c.id}.html`), 'utf8') === c.toolContent(),
          }
        : { reason: result.reason }),
    }
  } catch (err) {
    record.loop = { status: 'error', error: err instanceof Error ? err.message : String(err) }
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 3 })
  }
  record.finishedAt = new Date().toISOString()
  return { record, idea }
}

const summary = {
  runId: randomUUID().slice(0, 8),
  provider: { baseUrl, model },
  attemptsPerCase: ATTEMPTS_PER_CASE,
  ranAt: new Date().toISOString(),
  cases: [],
}

for (const c of CORPUS) {
  const caseSummary = { caseId: c.id, title: c.title, attempts: [] }
  for (let attempt = 1; attempt <= ATTEMPTS_PER_CASE; attempt++) {
    const { record } = await runCase(c, attempt)
    writeFileSync(join(runDir, `case-${c.id}-attempt-${attempt}.json`), `${JSON.stringify(record, null, 2)}\n`)
    caseSummary.attempts.push({
      attempt,
      ready: Boolean(record.synthesis),
      notReady: Boolean(record.notReady),
      providerError: record.providerError ?? null,
      agreementError: record.agreementError ?? null,
      loopStatus: record.loop?.status ?? null,
      workUnitState: record.loop?.workUnitState ?? null,
      verification: record.loop?.runOutcome?.verification ?? null,
      synthesisFromTurn: record.synthesisFromTurn ?? null,
    })
    console.log(
      `[${c.id}] attempt=${attempt} ready=${Boolean(record.synthesis)} notReady=${Boolean(record.notReady)} ` +
        `err=${record.providerError ?? record.agreementError ?? '-'} loop=${record.loop?.status ?? '-'}`,
    )
  }
  summary.cases.push(caseSummary)
}

writeFileSync(join(runDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`)

// Human-readable corpus for the human evaluator.
const md = CORPUS.map((c) => {
  const lines = [
    `## ${c.id} — ${c.title}`,
    '',
    `入口选择：${c.entry}`,
    '',
    ...c.turns.map((t, i) => `这个人说（第 ${i + 1} 条）：${t}`),
    '',
    '约束清单（must）:',
    ...c.constraintChecklist.must.map((m) => `- ${m}`),
    '约束清单（mustNot）:',
    ...c.constraintChecklist.mustNot.map((m) => `- ${m}`),
    '',
  ]
  return lines.join('\n')
}).join('\n')
writeFileSync(join(runDir, 'raw-intents.md'), `${md}\n`)

// Keep a copy of the corpus (with baselines) inside the run dir for review.
cpSync(
  fileURLToPath(new URL('../validation/real-synthesis-corpus/corpus.mjs', import.meta.url)),
  join(runDir, 'corpus.mjs'),
)

console.log(`\nsaved to ${runDir}`)