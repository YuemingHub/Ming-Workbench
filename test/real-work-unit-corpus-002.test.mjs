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
  synthesizeTurn,
  synthesizeAgreement,
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
  const cwd = mkdtempSync(join(tmpdir(), 'ming-family-records-002-'))
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

// A deterministic synthesis provider that plays "a correct LLM" for the
// family-records intent. This replaces the hand-authored synthesis of corpus
// 001: the idea is now built through the REAL synthesizeTurn /
// synthesizeAgreement with an injected provider, proving the seam.
function familyRecordsSynthesisProvider() {
  const synthesis = {
    desiredReality: '一个你和家人能随手记下零碎家事、随时翻看的小工具',
    strengths: ['你说清了痛点：家里零碎事老忘', '你说清了边界：随手记、随时看，不要复杂和注册'],
    path: ['定最小结果：记一条加看列表，关掉再开还在', '做成一个打开就能用的单页', '先给你用起来'],
    recommendation: '一个能随手记一条家事、随时翻看列表、关掉再开记录还在的小工具',
  }
  const agreement = {
    willGet: '一个能记、能看、关掉再开记录还在的家庭记录小工具',
    solves: '把家里零碎事从“老忘”变成“随手记、随时翻”',
    whereSee: '双击打开就能用，不用注册不用安装',
    notDoing: '不做账号、不做多设备同步、不做复杂分类',
  }
  return {
    async complete(systemPrompt) {
      if (systemPrompt.includes('MING_HUMAN_FIRST_AGREEMENT')) return JSON.stringify(agreement)
      return JSON.stringify({ reply: '我理解了：你想随手记家里零碎事、随时翻看，不要复杂。建议先做最小结果。', ready: true, synthesis })
    },
  }
}

test('P6 corpus 002: idea built through an injected synthesis provider -> unchanged closed loop', async () => {
  const projectRoot = createScratchProject()
  try {
    // Raw intent + human correction, ordinary language.
    let idea = createLetterIdea('2026-08-21T09:00:00.000Z')
    idea = beginIdea(idea)
    idea = chooseEntry(idea, '我只有一点模糊念头', '2026-08-21T09:00:00.001Z')
    idea = appendHumanTurn(idea, '家里那些零碎的，孩子今天说了句啥、要买啥、提醒老人吃药，老忘。想弄个小东西记下来', '2026-08-21T09:00:00.002Z')
    idea = appendHumanTurn(idea, '不用太复杂，随手记一笔、随时翻看就行，别整成要注册的', '2026-08-21T09:00:00.003Z')

    // Synthesis result + agreement now come from an INJECTED provider, not a
    // hand-authored object. The Workbench idea-space logic is unchanged.
    const provider = familyRecordsSynthesisProvider()
    const turn = await synthesizeTurn(undefined, idea, provider)
    assert.equal(turn.ready, true)
    idea = applySynthesis(idea, turn.synthesis, turn.reply, '2026-08-21T09:00:00.004Z')
    const agreement = await synthesizeAgreement(undefined, idea, provider)
    idea = applyAgreement(idea, agreement, '就这样', '2026-08-21T09:00:00.005Z')
    idea = confirmIdea(idea, '2026-08-21T09:00:00.006Z')

    // The confirmed idea feeds the SAME closed loop (coordinator + execution
    // still doubled; their wiring is identical to corpus 001).
    const result = await runFirstClosedLoop({
      idea,
      project: { projectRoot, trustedProject: true },
      harnessCheckout: mkdtempSync(join(tmpdir(), 'ming-harness-dummy-002-')),
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
    assert.equal(result.executionRun.intakeEnvelope.situation, 'idea')
    assert.equal(result.executionRun.intakeEnvelope.route, 'idea-to-build')
    assert.equal(result.executionRun.execution.runOutcome.verification, 'passed')
    assert.equal(result.executionRun.execution.runOutcome.acceptance, 'pending')

    // The synthesis produced by the injected provider is what the loop carried.
    assert.equal(result.executionRun.intakeEnvelope.raw_request, idea.synthesis.recommendation
      ? `${idea.synthesis.recommendation}；本轮会得到：${idea.agreement.willGet}；解决：${idea.agreement.solves}`
      : '')

    // Real artifact, real evidence — identical to corpus 001 because the loop
    // logic is unchanged; only the synthesis source changed.
    const after = readFileSync(join(projectRoot, 'family-records.html'), 'utf8')
    assert.ok(after.includes('<title>家庭记录</title>'))
    assert.equal(after, realTool)
    assert.equal(result.executionRun.execution.workUnit.state, 'verifying')
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 3 })
  }
})
