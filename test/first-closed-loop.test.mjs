import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
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
const newReadmeContent = '# Workbench Reality Test\n\nVersion: NEW\n'

function git(cwd, args) {
  return execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function createScratchProject() {
  const cwd = mkdtempSync(join(tmpdir(), 'ming-first-loop-'))
  git(cwd, ['init'])
  git(cwd, ['config', 'user.email', 'reality@local.test'])
  git(cwd, ['config', 'user.name', 'Reality'])
  writeFileSync(join(cwd, 'README.md'), '# Workbench Reality Test\n\nVersion: OLD\n')
  git(cwd, ['add', 'README.md'])
  git(cwd, ['commit', '-qm', 'init: OLD'])
  // No package.json: runProjectTests reports an honest no-command N/A, so
  // verification comes from repository readback (the smoke's pattern).
  writeFileSync(
    join(cwd, 'workbench.project.json'),
    JSON.stringify({
      schema_version: '1.0',
      project: { id: 'scratch-readme', title: 'Scratch Readme', domain_pack: 'development-aaop' },
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

function confirmedIdea() {
  let idea = createLetterIdea('2026-08-21T00:00:00.000Z')
  idea = beginIdea(idea)
  idea = chooseEntry(idea, '我已经有一个想法', '2026-08-21T00:00:00.001Z')
  idea = appendHumanTurn(idea, '把项目 README 的版本从 OLD 改成 NEW', '2026-08-21T00:00:00.002Z')
  idea = applySynthesis(idea, {
    desiredReality: 'README 反映最新版本',
    strengths: ['你明确要改 README 版本'],
    path: ['授权 README.md', '执行一次写入', '回读验证'],
    recommendation: '把项目 README 的 Version 从 OLD 改成 NEW',
  }, '整理成下面这样', '2026-08-21T00:00:00.003Z')
  idea = applyAgreement(idea, {
    willGet: '一个 Version 为 NEW 的 README',
    solves: '让 README 反映最新版本',
    whereSee: '在仓库里直接 git diff 看到',
    notDoing: '不改其他文件',
  }, '就这样', '2026-08-21T00:00:00.004Z')
  return confirmIdea(idea, '2026-08-21T00:00:00.005Z')
}

test('first closed loop: Human Intent -> Outcome -> AAOP Intake -> Execution -> Reality Change -> Evidence', async () => {
  const projectRoot = createScratchProject()
  try {
    const idea = confirmedIdea()
    const result = await runFirstClosedLoop({
      idea,
      project: { projectRoot, trustedProject: true },
      harnessCheckout: mkdtempSync(join(tmpdir(), 'ming-harness-dummy-')),
      workbenchRoot: repoRoot,
      authorizedFile: 'README.md',
      dependencies: {
        runCoordinator: createCoordinatorDouble(),
        runHarnessAcpGrant: createGrantRunDouble({ targetFile: 'README.md', newContent: newReadmeContent }),
      },
    })

    assert.equal(result.status, 'completed')

    // Honest verification: real mutation + real repository readback => passed;
    // acceptance stays human-owned (pending), never claimed by the loop.
    assert.equal(result.executionRun.execution.runOutcome.verification, 'passed')
    assert.equal(result.executionRun.execution.runOutcome.acceptance, 'pending')
    assert.equal(result.executionRun.execution.runOutcome.effect, 'mutation-observed')

    // Reality change: the real repository now carries Version: NEW.
    const after = readFileSync(join(projectRoot, 'README.md'), 'utf8')
    assert.ok(after.includes('Version: NEW'), `README did not reach NEW; got:\n${after}`)
    const diff = git(projectRoot, ['diff'])
    assert.match(diff, /-Version: OLD/)
    assert.match(diff, /\+Version: NEW/)

    // Evidence return: the real readback + authoritative evidence.
    assert.ok(result.evidenceReturn.realityChange.executionProducedChanges.includes('README.md'))
    assert.deepEqual(result.evidenceReturn.realityChange.scopeViolations, [])
    const authoritative = result.evidenceReturn.evidence.filter((e) => e.authoritative && e.verification === 'passed')
    assert.equal(authoritative.length, 1, 'exactly one authoritative passed evidence item')
    assert.equal(authoritative[0].verifier, 'test-run')

    // Traceable id chain: idea -> workUnit -> grant -> session.
    assert.equal(result.executionRun.ideaId, idea.id)
    assert.equal(result.executionRun.workUnitId, result.executionRun.execution.workUnit.id)
    assert.ok(result.executionRun.grantId.startsWith('GRANT-'))
    assert.ok(result.executionRun.sessionId.startsWith('SESS-'))

    // The Work Unit is verifying, not completed — no fabricated completion.
    assert.equal(result.executionRun.execution.workUnit.state, 'verifying')
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 3 })
  }
})

test('first closed loop refuses an unconfirmed idea before touching the repository', async () => {
  const projectRoot = createScratchProject()
  try {
    let idea = createLetterIdea('2026-08-21T00:00:00.000Z')
    idea = beginIdea(idea)
    idea = chooseEntry(idea, '我已经有一个想法', '2026-08-21T00:00:00.001Z')
    idea = appendHumanTurn(idea, '把项目 README 的版本改掉', '2026-08-21T00:00:00.002Z')
    // Never synthesized / agreed / confirmed.

    await assert.rejects(
      () => runFirstClosedLoop({
        idea,
        project: { projectRoot, trustedProject: true },
        harnessCheckout: '/dev/null',
        workbenchRoot: repoRoot,
        authorizedFile: 'README.md',
        dependencies: { runCoordinator: createCoordinatorDouble(), runHarnessAcpGrant: createGrantRunDouble() },
      }),
      /unconfirmed/,
    )

    // The repository is untouched.
    const readme = readFileSync(join(projectRoot, 'README.md'), 'utf8')
    assert.ok(readme.includes('Version: OLD'))
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 3 })
  }
})

test('first closed loop needs-human when a genuine human-owned question gates the Work Unit', async () => {
  const projectRoot = createScratchProject()
  try {
    const idea = confirmedIdea()
    const coordinatorWithQuestion = async (options) => {
      const double = createCoordinatorDouble()
      const result = await double(options)
      // Force a genuinely human-owned question onto the Work Unit.
      result.workUnit.gate = { kind: 'human-decision', open: true, summary: 'Which version label do you want?' }
      result.workUnit.state = 'needs-human'
      result.workUnit.nextFrontier = 'Which version label do you want?'
      return result
    }

    const result = await runFirstClosedLoop({
      idea,
      project: { projectRoot, trustedProject: true },
      harnessCheckout: '/dev/null',
      workbenchRoot: repoRoot,
      authorizedFile: 'README.md',
      dependencies: {
        runCoordinator: coordinatorWithQuestion,
        runHarnessAcpGrant: createGrantRunDouble(),
      },
    })

    assert.equal(result.status, 'needs-human')
    assert.equal(result.workUnit.gate.open, true)
    // No execution happened: the repository is untouched.
    assert.ok(readFileSync(join(projectRoot, 'README.md'), 'utf8').includes('Version: OLD'))
  } finally {
    rmSync(projectRoot, { recursive: true, force: true, maxRetries: 3 })
  }
})
