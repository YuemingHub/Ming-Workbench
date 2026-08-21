#!/usr/bin/env node
/**
 * Real LLM synthesis validation.
 *
 * Runs the Workbench Outcome stage (synthesizeTurn + synthesizeAgreement) with
 * a REAL provider, on the family-records fuzzy intent, then feeds the
 * confirmed idea through the closed loop with execution STILL DOUBLED (per the
 * validation strategy: isolate the synthesis variable first; do not yet touch
 * the real Harness transport).
 *
 * Credentials come ONLY from the environment — never from a committed file:
 *   MING_SYNTHESIS_BASE_URL  e.g. https://api.stepfun.com/step_plan/v1
 *   MING_SYNTHESIS_API_KEY   the bearer key
 *   MING_SYNTHESIS_MODEL     e.g. step-3.7-flash
 *
 * Observation goals:
 *   - Is the synthesis grounded in what the human actually said?
 *   - Does it over-design (force a tech stack / scope creep)?
 *   - Does the recommendation stay a smallest complete real outcome?
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  synthesizeAgreement,
} from '../.tmp/idea/index.js'
import { runFirstClosedLoop } from '../.tmp/execution/first-closed-loop.js'
import { createCoordinatorDouble, createGrantRunDouble } from '../test/fixtures/harness-doubles.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const bridgeFixture = fileURLToPath(new URL('../test/fixtures/aaop-bridge-fixture.mjs', import.meta.url))
const familyRecordsHtml = fileURLToPath(new URL('../test/fixtures/family-records-tool.html', import.meta.url))
const realTool = readFileSync(familyRecordsHtml, 'utf8')

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

function createScratchProject() {
  const cwd = mkdtempSync(join(tmpdir(), 'ming-real-synthesis-'))
  git(cwd, ['init'])
  git(cwd, ['config', 'user.email', 'reality@local.test'])
  git(cwd, ['config', 'user.name', 'Reality'])
  writeFileSync(join(cwd, 'README.md'), '# Family Records Project\n')
  writeFileSync(join(cwd, 'family-records.html'), '<!-- placeholder -->\n')
  git(cwd, ['add', '.'])
  git(cwd, ['commit', '-qm', 'init: placeholder'])
  writeFileSync(
    join(cwd, 'workbench.project.json'),
    JSON.stringify({
      schema_version: '1.0',
      project: { id: 'family-records', title: 'Family Records', domain_pack: 'development-aaop' },
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

const endpoint = { baseUrl, apiKey, model }

// --- Raw intent: ordinary, fuzzy, no tech stack named ---
let idea = createLetterIdea('2026-08-21T09:00:00.000Z')
idea = beginIdea(idea)
idea = chooseEntry(idea, '我只有一点模糊念头', '2026-08-21T09:00:00.001Z')
idea = appendHumanTurn(idea, '家里那些零碎的，孩子今天说了句啥、要买啥、提醒老人吃药，老忘。想弄个小东西记下来', '2026-08-21T09:00:00.002Z')
idea = appendHumanTurn(idea, '不用太复杂，随手记一笔、随时翻看就行，别整成要注册的', '2026-08-21T09:00:00.003Z')

console.log('=== provider ===')
console.log(`${baseUrl}  model=${model}`)

console.log('\n=== synthesizeTurn (REAL LLM) ===')
const turn = await synthesizeTurn(endpoint, idea)
console.log('ready:', turn.ready)
console.log('reply:', turn.reply)
if (turn.synthesis) {
  console.log('synthesis:', JSON.stringify(turn.synthesis, null, 2))
}

if (!turn.ready || !turn.synthesis) {
  console.log('\n[synthesis not ready — the loop stops here; no execution]')
  process.exit(0)
}

idea = applySynthesis(idea, turn.synthesis, turn.reply, '2026-08-21T09:00:00.004Z')

console.log('\n=== synthesizeAgreement (REAL LLM) ===')
const agreement = await synthesizeAgreement(endpoint, idea)
console.log('agreement:', JSON.stringify(agreement, null, 2))

idea = applyAgreement(idea, agreement, '就这样', '2026-08-21T09:00:00.005Z')
idea = confirmIdea(idea, '2026-08-21T09:00:00.006Z')

console.log('\n=== closed loop (execution STILL DOUBLED) ===')
const projectRoot = createScratchProject()
try {
  const result = await runFirstClosedLoop({
    idea,
    project: { projectRoot, trustedProject: true },
    harnessCheckout: mkdtempSync(join(tmpdir(), 'ming-harness-dummy-real-')),
    workbenchRoot: repoRoot,
    authorizedFile: 'family-records.html',
    dependencies: {
      runCoordinator: createCoordinatorDouble({
        situation: 'idea',
        route: 'idea-to-build',
        route_confidence: 0.85,
        project_evidence_summary: ['family-records.html — 占位空文件，最小结果将在此创建一个单页记录工具'],
        next_action: 'Authorize a bounded creation of family-records.html — a self-contained page that adds and lists family records persisted locally.',
      }),
      runHarnessAcpGrant: createGrantRunDouble({ targetFile: 'family-records.html', newContent: realTool }),
    },
  })

  console.log('status:', result.status)
  if (result.status === 'completed') {
    console.log('runOutcome:', JSON.stringify(result.executionRun.execution.runOutcome))
    console.log('workUnit.state:', result.executionRun.execution.workUnit.state)
    console.log('artifact == family-records-tool:', readFileSync(join(projectRoot, 'family-records.html'), 'utf8') === realTool)
  } else {
    console.log('reason:', result.reason)
  }
} finally {
  rmSync(projectRoot, { recursive: true, force: true, maxRetries: 3 })
}
