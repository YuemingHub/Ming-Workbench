#!/usr/bin/env node
/**
 * Stage 3 — deterministic first-real-outcome vertical slice.
 *
 * Proves the missing bridge end-to-end with the REAL reviewed-Harness ACP
 * transport (not a harness double), a REAL git-baselined scratch workspace,
 * the AAOP intake + grant + bounded-execution chain, and optional browser
 * verification. The only non-real component is the provider: a deterministic
 * repository-owned fixture drives the real agent loop.
 *
 *   confirmed HumanFirstIdea (daily-notes)
 *   -> bridgeConfirmedIdeaToExecution -> ExecutableGoal + Work Unit
 *   -> scratch git workspace + baseline commit
 *   -> AAOP Developer Intake (real read-only ACP session)
 *   -> mutation scope proposal + frozen exact slice
 *   -> Provider Execution Grant (AAOP canonical)
 *   -> bounded execution (real ACP write inside isolation, delta verified,
 *      applied back to the real workspace)
 *   -> optional browser exercise of the produced index.html (Electron/Chromium)
 *
 * Evidence level: deterministic E0/E1 transport + scratch-repository readback
 * rehearsal. Browser exercise, when available, is still fixture-backed and is
 * NOT L3/L4 evidence or proof that a real paid provider produced the outcome.
 *
 *   REAL PAID PROVIDER: NOT RUN
 *
 * Usage:
 *   node scripts/stage3-first-outcome-slice.mjs
 *   MING_HARNESS_CHECKOUT=<path> node scripts/stage3-first-outcome-slice.mjs
 */

import { execFileSync, spawn } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { bridgeConfirmedIdeaToExecution } from '../.tmp/bridge/index.js'
import { projectOutcomeFromRun } from '../.tmp/outcome/project-outcome.js'
import { prepareProjectDevelopmentIntake, runProjectAaopCoordinator } from '../.tmp/index.js'
import { readRepositorySnapshot } from '../.tmp/execution/repository.js'
import { proposeMutationScope } from '../.tmp/execution/scope-proposal.js'
import { buildExactSlice } from '../.tmp/execution/mutation-slice.js'
import { issueProviderExecutionGrant } from '../.tmp/execution/grant-issuance.js'
import { runBoundedExecution } from '../.tmp/execution/bounded-execution.js'
import { canMarkCompleted } from '../.tmp/core/model.js'
import { resolveSoftwareExecutionCapability } from '../.tmp/capability/capability-resolution.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const harnessCheckout = resolve(
  process.env.MING_HARNESS_CHECKOUT ?? join(root, '.workbench', 'vendor', 'deepseek-harness'),
)
const FIXTURE_PORT = Number(process.env.FIXTURE_PORT ?? 8737)
const FIXTURE_API_KEY = process.env.FIXTURE_API_KEY ?? 'stage3-fixture-key'
const FIXTURE_TARGET = process.env.FIXTURE_TARGET_DIR ?? mkdtempSync(join(tmpdir(), 'stage3-daily-notes-'))
const SESSION_ROOT = join(root, '.workbench', 'runtime', 'stage3-first-outcome-sessions')

let failures = 0
function check(condition, label, detail = '') {
  const ok = Boolean(condition)
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${detail ? ` (${detail})` : ''}`)
  if (!ok) failures += 1
}

function runGit(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function waitForLine(stream, predicate, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    let buffer = ''
    const timer = setTimeout(() => reject(new Error('timed out waiting for fixture ready')), timeoutMs)
    const onData = (chunk) => {
      buffer += chunk.toString()
      const lines = buffer.split(/\r?\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const match = predicate(line)
        if (match) {
          clearTimeout(timer)
          stream.off('data', onData)
          resolvePromise(match)
          return
        }
      }
    }
    stream.on('data', onData)
  })
}

function confirmedDailyNotesIdea(now) {
  return {
    id: 'idea-stage3-daily-notes',
    stage: 'confirmed',
    entry: '我已经有一个想法',
    turns: [
      { role: 'human', text: '我想做一个自己每天能用的记录小网页。', at: now },
      { role: 'human', text: '我可以输入一句话保存下来，刷新以后它还在，关闭后下次打开还能继续记录。', at: now },
    ],
    synthesis: {
      desiredReality: '把「每天记录一句话，关了再开还能看到」这件事做成',
      strengths: ['你已经清楚地说了你想要什么：一个每天能用的记录小网页', '你补充了细节：刷新还在、关闭再打开也还在'],
      path: ['先把这件事的核心定下来', '做出最小的能真正用起来的版本', '做出来给你亲自看'],
      recommendation: '先做出一个能实现「每天记录一句话、刷新还在、关闭再打开还在」的最小网页',
    },
    agreement: {
      willGet: '这一轮你会得到一个能直接打开的「每日记录」网页：输入一句话，点保存，它就记下来。',
      solves: '把你心里「记录每天发生的事、之后还能翻回来」这件事，从想法变成一个看得见、用得上的网页。',
      whereSee: '做完之后，你在浏览器里打开这个网页就能用。',
      notDoing: '这一轮不做账号、不上传云端、不做多设备同步，只做你本机这一个网页。',
    },
    confirmedAt: now,
    createdAt: now,
    updatedAt: now,
  }
}

async function main() {
  // ---- 0. deterministic fixture provider (real transport, fake provider) ----
  const fixture = spawn(
    process.execPath,
    ['scripts/stage3-fixture-server.mjs'],
    {
      cwd: root,
      env: {
        ...process.env,
        FIXTURE_PORT: String(FIXTURE_PORT),
        FIXTURE_API_KEY,
      },
      stdio: ['ignore', 'pipe', 'inherit'],
      windowsHide: true,
    },
  )
  try {
    await waitForLine(fixture.stdout, (line) => (line.includes('stage3-fixture ready') ? line : null), 60_000)
    fixture.stdout.on('data', (chunk) => {
      process.stdout.write(`[fixture] ${chunk}`)
    })
    process.env.DEEPSEEK_API_KEY = FIXTURE_API_KEY
    process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${FIXTURE_PORT}/v1`
    process.env.MING_HARNESS_PROVIDER = 'deepseek-official'
    process.env.MING_HARNESS_MODEL = 'deepseek-v4-pro'
    console.log(`fixture ready; provider base = ${process.env.DEEPSEEK_BASE_URL}`)

  const now = new Date().toISOString()

  // ---- 1. bridge: confirmed agreement -> executable goal -> Work Unit ----
  const idea = confirmedDailyNotesIdea(now)
  const bridged = bridgeConfirmedIdeaToExecution(idea, {
    spaceId: 'SPACE-stage3-daily-notes',
    idFactory: () => 'stage3-daily-notes',
    now: () => new Date(now),
  })
  if (bridged.status !== 'software-execution') {
    throw new Error(`bridge did not route to software execution: ${bridged.status}`)
  }
  const workUnit = bridged.workUnit
  check(bridged.route.route === 'software_development', 'bridge routes the confirmed idea to software execution')
  check(workUnit.id === 'WU-stage3-daily-notes', 'bridge created the Work Unit through the existing factory', workUnit.id)
  check(workUnit.state === 'intake', 'Work Unit starts in intake state')

  // ---- 2. real git-baselined scratch workspace ----
  mkdirSync(FIXTURE_TARGET, { recursive: true })
  runGit(FIXTURE_TARGET, ['init', '-q'])
  runGit(FIXTURE_TARGET, ['config', 'user.email', 'stage3@local.test'])
  runGit(FIXTURE_TARGET, ['config', 'user.name', 'Stage 3 Slice'])
  writeFileSync(join(FIXTURE_TARGET, 'README.md'), '# Daily Notes\n\nBaseline stub for the first real low-risk outcome.\n')
  writeFileSync(join(FIXTURE_TARGET, 'index.html'), '<!-- daily notes placeholder -->\n')
  runGit(FIXTURE_TARGET, ['add', '.'])
  runGit(FIXTURE_TARGET, ['commit', '-qm', 'init: daily-notes stub baseline'])
  const before = readFileSync(join(FIXTURE_TARGET, 'index.html'), 'utf8')
  check(before.includes('placeholder'), 'scratch workspace has a git-baselined stub index.html')

  // ---- 3. AAOP Developer Intake (real read-only ACP session) ----
  const manifest = {
    schema_version: '1.0',
    project: {
      id: 'stage3-daily-notes',
      title: 'Daily Notes',
      domain_pack: 'development-aaop',
    },
    development: {
      aaop_bridge: {
        ready: { command: process.execPath, args: ['-e', "console.log('AAOP READY')"], timeoutMs: 10_000 },
        status: { command: process.execPath, args: ['-e', "console.log(JSON.stringify({project:'daily-notes',stage:'development'}))"], timeoutMs: 10_000 },
        prompt: { command: process.execPath, args: ['-e', "console.log('Inspect current repository evidence read-only and derive AAOP canonical Developer Intake.')"], timeoutMs: 10_000 },
      },
    },
  }
  const prepared = prepareProjectDevelopmentIntake({
    rawRequest: bridged.goal.goalStatement,
    projectRoot: FIXTURE_TARGET,
    spaceId: workUnit.spaceId,
    trustedProject: true,
    manifest,
    now: () => new Date(now),
    idFactory: () => 'stage3-daily-notes',
  })
  if (prepared.status !== 'ready-for-aaop-coordinator') {
    throw new Error(`project bridge did not become coordinator-ready: ${prepared.reason ?? prepared.status}`)
  }
  const intake = await runProjectAaopCoordinator({
    prepared,
    projectRoot: FIXTURE_TARGET,
    harnessCheckout,
    workbenchRoot: root,
    provider: 'deepseek-official',
    model: 'deepseek-v4-pro',
    sessionRoot: SESSION_ROOT,
    now: () => new Date(now),
  })
  check(intake.stopReason === 'end_turn', 'AAOP intake reached a complete end_turn')
  check(intake.workUnit.state === 'ready', 'AAOP intake reconciled the Work Unit to ready', intake.workUnit.state)
  check(
    intake.envelope.project_evidence_summary.some((line) => line.includes('index.html')),
    'AAOP intake grounded the mutation surface on index.html',
  )

  // ---- 4. mutation scope proposal -> frozen exact slice ----
  const snapshot = readRepositorySnapshot(FIXTURE_TARGET)
  const proposal = proposeMutationScope({
    projectRoot: FIXTURE_TARGET,
    rawRequest: bridged.goal.goalStatement,
    intakeEvidence: intake.envelope.project_evidence_summary,
    nextAction: intake.envelope.next_action,
    route: intake.envelope.route,
  })
  check(
    proposal.items.some((item) => item.path === 'index.html'),
    'scope proposal derives index.html from AAOP evidence',
  )
  const slice = buildExactSlice(FIXTURE_TARGET, snapshot.head, ['index.html'])

  // ---- 5. AAOP canonical Provider Execution Grant ----
  const { grant, binding } = issueProviderExecutionGrant({
    workUnit: intake.workUnit,
    projectRoot: FIXTURE_TARGET,
    snapshot,
    slice,
    scopeBoundary: bridged.goal.scopeBoundary,
    now: () => new Date(now),
  })
  check(grant.authorization.mutation_boundary === 'write-authorized', 'grant is write-authorized')
  check(grant.goal.length > 0, 'grant goal carries the compiled goal statement')

  // ---- 6. bounded execution (real ACP write inside isolation) ----
  const result = await runBoundedExecution({
    workUnit: intake.workUnit,
    grant,
    binding,
    slice,
    projectRoot: FIXTURE_TARGET,
    harnessCheckout,
    workbenchRoot: root,
    provider: 'deepseek-official',
    model: 'deepseek-v4-pro',
    sessionRoot: SESSION_ROOT,
    allowWrite: true,
  })

  // ---- 7. independent real-repository evidence ----
  const after = readFileSync(join(FIXTURE_TARGET, 'index.html'), 'utf8')
  const diff = runGit(FIXTURE_TARGET, ['diff'])
  check(result.runOutcome.verification === 'passed', 'verification verdict is passed', result.runOutcome.verification)
  check(result.runOutcome.effect === 'mutation-observed', 'mutation observed', result.runOutcome.effect)
  check(result.runOutcome.acceptance === 'pending', 'acceptance stays human-owned pending')
  check(
    result.repositoryReadback.executionProducedChanges.includes('index.html'),
    'execution produced the index.html change',
  )
  check(result.repositoryReadback.scopeViolations.length === 0, 'no scope violations')
  check(after.includes('每日记录'), 'fixture-scripted index.html content is present in the real workspace readback')
  check(after.includes('localStorage'), 'fixture-scripted page content includes localStorage persistence')
  check(
    result.workUnit.evidence.some((e) => e.kind === 'repository'),
    'execution evidence recorded',
  )
  check(
    result.workUnit.evidence.some((e) => e.authoritative === true),
    'authoritative real evidence recorded',
  )
  check(canMarkCompleted(result.workUnit) === false, 'the run outcome alone never completes the Work Unit')

  // ---- 8. outcome projection (Stage 3-C) ----
  const projected = projectOutcomeFromRun(result.runOutcome)
  check(projected.status === 'partial', 'outcome projection is partial (verified, awaiting human acceptance)', projected.status)
  console.log(`outcome projection: ${JSON.stringify(projected)}`)

  // ---- 9. optional browser exercise (never promoted to real-provider/L3 truth) ----
  let browserVerification = 'NOT_PROVEN'
  if (process.platform === 'linux' && existsSync('/usr/bin/xvfb-run')) {
    execFileSync('xvfb-run', ['-a', 'node', join(root, 'scripts', 'stage3-browser-verify.mjs'), join(FIXTURE_TARGET, 'index.html')], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['inherit', 'pipe', 'pipe'],
      timeout: 180_000,
    })
    browserVerification = 'PASS_FIXTURE_BACKED'
  } else {
    console.log('SKIP: browser exercise requires a Linux host with xvfb-run (fixture-backed browser evidence not proven)')
    failures += 1
  }

  console.log(JSON.stringify({
    slice: 'stage3-first-real-outcome',
    bridge: 'confirmed-agreement-to-execution',
    route: bridged.route.route,
    workUnitId: result.workUnit.id,
    workUnitState: result.workUnit.state,
    runStatus: result.runOutcome.runStatus,
    effect: result.runOutcome.effect,
    verification: result.runOutcome.verification,
    acceptance: result.runOutcome.acceptance,
    projection: projected.status,
    capabilityDecision: resolveSoftwareExecutionCapability({
      workUnit: result.workUnit,
      harnessCheckout,
    }),
    browserVerification,
    producedFiles: result.repositoryReadback.executionProducedChanges,
    evidenceCount: result.workUnit.evidence.length,
    completionLocked: true,
    contentTruth: 'SCRIPTED_FIXTURE_READBACK_ONLY',
    realPaidProvider: 'NOT RUN',
    artifact: join(FIXTURE_TARGET, 'index.html'),
  }, null, 2))

  if (failures > 0) throw new Error(`stage3 slice failed with ${failures} failing check(s)`)
  } finally {
    fixture.kill('SIGTERM')
  }
}

main().catch((error) => {
  console.error(`stage3 slice failed: ${error.message}`)
  process.exit(1)
})
