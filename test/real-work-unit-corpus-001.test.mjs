import test from 'node:test'
import assert from 'node:assert/strict'
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
} from '../.tmp/idea/index.js'
import { runFirstClosedLoop } from '../.tmp/execution/first-closed-loop.js'
import { createCoordinatorDouble, createGrantRunDouble } from './fixtures/harness-doubles.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const bridgeFixture = fileURLToPath(new URL('./fixtures/aaop-bridge-fixture.mjs', import.meta.url))
const familyRecordsHtml = fileURLToPath(new URL('./fixtures/family-records-tool.html', import.meta.url))
const realTool = readFileSync(familyRecordsHtml, 'utf8')

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function createScratchProject() {
  const cwd = mkdtempSync(join(tmpdir(), 'ming-family-records-'))
  git(cwd, ['init'])
  git(cwd, ['config', 'user.email', 'reality@local.test'])
  git(cwd, ['config', 'user.name', 'Reality'])
  writeFileSync(join(cwd, 'README.md'), '# Family Records Project\n\nA place to keep the small things at home.\n')
  // The artifact target starts as a placeholder; the loop replaces it with the
  // real self-contained family-records tool.
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

// A non-technical, fuzzy human intent — ordinary language, no tech stack named.
function confirmedFamilyRecordsIdea() {
  let idea = createLetterIdea('2026-08-21T09:00:00.000Z')
  idea = beginIdea(idea)
  idea = chooseEntry(idea, '我只有一点模糊念头', '2026-08-21T09:00:01.000Z')
  idea = appendHumanTurn(idea, '脑子里老有个事，家里那些零碎的，孩子今天说了句啥、要买啥、提醒老人吃药，老忘。想弄个小东西记下来，翻出来就能看', '2026-08-21T09:00:02.000Z')
  // A human correction that bounds the scope — the kind a real person adds.
  idea = appendHumanTurn(idea, '不用太复杂，就我和家里人能随手记一笔、随时翻看就行，别整成那种要注册要登录的', '2026-08-21T09:00:03.000Z')
  idea = applySynthesis(idea, {
    desiredReality: '一个你和家人能随手记下零碎家事、随时翻看的小工具',
    strengths: ['你已说清痛点：家里零碎事老忘', '你也说了边界：随手记、随时看，不要复杂和注册'],
    path: ['定最小结果：记一条加看列表，关掉再开还在', '做成一个打开就能用的单页', '先给你用起来'],
    recommendation: '一个能随手记一条家事、随时翻看列表、关掉再开记录还在的小工具',
  }, '整理成下面这样', '2026-08-21T09:00:04.000Z')
  idea = applyAgreement(idea, {
    willGet: '一个能记、能看、关掉再开记录还在的家庭记录小工具',
    solves: '把家里零碎事从“老忘”变成“随手记、随时翻”',
    whereSee: '双击打开就能用，不用注册不用安装',
    notDoing: '不做账号、不做多设备同步、不做复杂分类',
  }, '就这样', '2026-08-21T09:00:05.000Z')
  return confirmIdea(idea, '2026-08-21T09:00:06.000Z')
}

test('P6 corpus 001: non-technical intent (family records) -> real usable artifact through the closed loop', async () => {
  const projectRoot = createScratchProject()
  try {
    const idea = confirmedFamilyRecordsIdea()
    const result = await runFirstClosedLoop({
      idea,
      project: { projectRoot, trustedProject: true },
      harnessCheckout: mkdtempSync(join(tmpdir(), 'ming-harness-dummy-')),
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

    assert.equal(result.status, 'completed')

    // AAOP classified a fuzzy new-idea intent correctly (idea / idea-to-build),
    // not forced into a code-change route.
    assert.equal(result.executionRun.intakeEnvelope.situation, 'idea')
    assert.equal(result.executionRun.intakeEnvelope.route, 'idea-to-build')

    // Honest outcome: verified by repository readback, acceptance stays human-owned.
    assert.equal(result.executionRun.execution.runOutcome.verification, 'passed')
    assert.equal(result.executionRun.execution.runOutcome.acceptance, 'pending')

    // Reality change: a real, usable family-records tool now lives in the repo.
    const after = readFileSync(join(projectRoot, 'family-records.html'), 'utf8')
    assert.ok(after.includes('<title>家庭记录</title>'), 'artifact has the family-records title')
    assert.ok(after.includes('localStorage'), 'artifact persists records locally')
    assert.ok(after.includes('id="form"'), 'artifact has the add-record form')
    assert.equal(after, realTool, 'the applied artifact equals the authored real tool')

    const diff = git(projectRoot, ['diff', '--', 'family-records.html'])
    assert.match(diff, /-<!-- placeholder -->/)
    assert.match(diff, /\+<!DOCTYPE html>/)

    // Evidence: one authoritative passed item + the non-authoritative run record.
    assert.ok(result.evidenceReturn.realityChange.executionProducedChanges.includes('family-records.html'))
    const authoritative = result.evidenceReturn.evidence.filter((e) => e.authoritative && e.verification === 'passed')
    assert.equal(authoritative.length, 1)

    // The Work Unit is verifying — not fabricated complete.
    assert.equal(result.executionRun.execution.workUnit.state, 'verifying')
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 3 })
  }
})
