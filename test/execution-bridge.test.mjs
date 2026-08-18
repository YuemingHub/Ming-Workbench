import test from 'node:test'
import assert from 'node:assert/strict'

import {
  bridgeConfirmedIdeaToExecution,
  compileExecutableGoal,
  routeForConfirmedIdea,
  projectOutcomeFromRun,
} from '../.tmp/bridge/index.js'
import { canMarkCompleted } from '../.tmp/core/model.js'

/**
 * Stage 3 — Confirmed-agreement -> Execution bridge.
 *
 * The bridge is the missing layer between the human-first V1 confirmed round
 * agreement and the existing AAOP -> Harness execution chain. These tests pin
 * the deterministic semantics:
 *
 *   - compileExecutableGoal quotes ONLY what the human agreed to.
 *   - routeForConfirmedIdea is a conservative, deterministic classifier.
 *   - bridgeConfirmedIdeaToExecution creates a real Work Unit via
 *     createIntakeWorkUnit for software routes and answers honestly otherwise.
 *   - projectOutcomeFromRun maps the four run-outcome axes to a fact-derived
 *     projection; a run outcome can never mark a Work Unit complete by itself.
 */

const NOW = '2026-08-18T00:00:00.000Z'

function baseIdea(overrides = {}) {
  return {
    id: 'idea-bridge-test',
    stage: 'confirmed',
    entry: '我已经有一个想法',
    turns: [
      { role: 'human', text: '我想做一个自己每天能用的记录小网页。', at: NOW },
      { role: 'human', text: '我可以输入一句话保存下来，刷新以后还在，关闭再打开也还在。', at: NOW },
    ],
    synthesis: {
      desiredReality: '把「每天记录一句话，关了再开还能看到」这件事做成',
      strengths: ['你已经清楚地说了你想要什么', '你补充了细节：刷新还在、关闭再打开也还在'],
      path: ['先把核心定下来', '做出最小能用的版本', '做出来给你亲自看'],
      recommendation: '先做出一个能实现「每天记录一句话、刷新还在、关闭再打开还在」的最小网页',
    },
    agreement: {
      willGet: '这一轮你会得到一个能直接打开的「每日记录」网页：输入一句话，点保存，它就记下来。',
      solves: '把你心里「记录每天发生的事、之后还能翻回来」这件事，从想法变成一个看得见、用得上的网页。',
      whereSee: '做完之后，你在浏览器里打开这个网页就能用。',
      notDoing: '这一轮不做账号、不上传云端、不做多设备同步，只做你本机这一个网页。',
    },
    confirmedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function nonSoftwareAgreement() {
  return {
    willGet: '这一轮你会得到一份明确的一周锻炼计划安排表。',
    solves: '把你「不知道每周怎么安排锻炼」这件事理清楚。',
    whereSee: '做完之后，你每周按照这份安排去执行就行。',
    notDoing: '这一轮不做健身器材购买，也不做饮食方案。',
  }
}

test('compileExecutableGoal quotes only what the human agreed to', () => {
  const idea = baseIdea()
  const goal = compileExecutableGoal(idea)

  assert.equal(goal.sourceIdeaId, idea.id)
  assert.equal(goal.route, 'software_development')
  assert.match(goal.goalStatement, /每日记录/)
  assert.ok(goal.goalStatement.length > 0)
  assert.ok(goal.acceptanceCriteria.length >= 3)
  assert.ok(
    goal.acceptanceCriteria.some((criterion) => criterion.startsWith('得到：')),
    'acceptance criteria must quote willGet',
  )
  assert.ok(
    goal.acceptanceCriteria.some((criterion) => criterion.startsWith('解决：')),
    'acceptance criteria must quote solves',
  )
  assert.ok(
    goal.acceptanceCriteria.some((criterion) => criterion.startsWith('使用方式：')),
    'acceptance criteria must quote whereSee',
  )
  assert.deepEqual(goal.scopeBoundary, [idea.agreement.notDoing])
  assert.equal(goal.usageSurface, idea.agreement.whereSee)
})

test('compileExecutableGoal refuses an idea that is not confirmed', () => {
  const idea = baseIdea({ stage: 'agreement' })
  assert.throws(() => compileExecutableGoal(idea), /not confirmed/)
})

test('compileExecutableGoal refuses an idea without a round agreement', () => {
  const idea = baseIdea({ agreement: undefined, synthesis: undefined })
  assert.throws(() => compileExecutableGoal(idea), /no round agreement/)
})

test('routeForConfirmedIdea routes a software surface to software_development', () => {
  const decision = routeForConfirmedIdea(baseIdea())
  assert.equal(decision.route, 'software_development')
  assert.ok(decision.matchedOn.includes('网页'))
  assert.match(decision.reason, /网页/)
})

test('routeForConfirmedIdea stays unsupported when no software surface is named', () => {
  const idea = baseIdea({
    agreement: nonSoftwareAgreement(),
    synthesis: {
      desiredReality: '把「每周锻炼安排」这件事理清楚',
      strengths: ['你清楚地说了你想要什么'],
      path: ['先把核心定下来', '做出每周能照着执行的一份安排'],
      recommendation: '先做出一份你每周能照着执行的一周锻炼安排表',
    },
  })
  const decision = routeForConfirmedIdea(idea)
  assert.equal(decision.route, 'unsupported')
  assert.deepEqual(decision.matchedOn, [])
})

test('bridgeConfirmedIdeaToExecution creates a Work Unit through the existing factory', () => {
  const result = bridgeConfirmedIdeaToExecution(baseIdea(), {
    spaceId: 'SPACE-bridge-test',
    idFactory: () => 'fixed-id',
    now: () => new Date(NOW),
  })

  assert.equal(result.status, 'software-execution')
  if (result.status !== 'software-execution') return

  assert.equal(result.workUnit.id, 'WU-fixed-id')
  assert.equal(result.workUnit.spaceId, 'SPACE-bridge-test')
  assert.equal(result.workUnit.state, 'intake')
  assert.equal(result.workUnit.owner, 'development-aaop')
  assert.equal(result.workUnit.outcome, result.goal.goalStatement)
  assert.ok(result.workUnit.title.length > 0)
  assert.equal(result.workUnit.acceptance.length, 0)
  assert.equal(result.workUnit.evidence.length, 0)
})

test('bridgeConfirmedIdeaToExecution answers honestly when the route is unsupported', () => {
  const idea = baseIdea({
    agreement: nonSoftwareAgreement(),
    synthesis: {
      desiredReality: '把「每周锻炼安排」这件事理清楚',
      strengths: ['你清楚地说了你想要什么'],
      path: ['先把核心定下来', '做出每周能照着执行的一份安排'],
      recommendation: '先做出一份你每周能照着执行的一周锻炼安排表',
    },
  })
  const result = bridgeConfirmedIdeaToExecution(idea, { spaceId: 'SPACE-bridge-test' })

  assert.equal(result.status, 'unsupported')
  if (result.status !== 'unsupported') return
  assert.equal(result.route.route, 'unsupported')
  assert.match(result.reason, /does not name a software surface/)
})

test('bridgeConfirmedIdeaToExecution rejects a non-confirmed idea', () => {
  const idea = baseIdea({ stage: 'conversation', agreement: undefined })
  assert.throws(() => bridgeConfirmedIdeaToExecution(idea, { spaceId: 'SPACE-bridge-test' }))
})

test('projectOutcomeFromRun maps the four axes to a fact-derived projection', () => {
  const partial = projectOutcomeFromRun({
    runStatus: 'completed',
    effect: 'mutation-observed',
    verification: 'passed',
    acceptance: 'pending',
    reason: 'Local changes produced; tests passed.',
  })
  assert.equal(partial.status, 'partial')
  assert.match(partial.summary, /亲自验收/)

  const completed = projectOutcomeFromRun({
    runStatus: 'completed',
    effect: 'mutation-observed',
    verification: 'passed',
    acceptance: 'accepted',
    reason: 'Human accepted the outcome.',
  })
  assert.equal(completed.status, 'completed')

  const failed = projectOutcomeFromRun({
    runStatus: 'completed',
    effect: 'mutation-observed',
    verification: 'failed',
    acceptance: 'rejected',
    reason: 'Changes produced but project tests failed.',
  })
  assert.equal(failed.status, 'failed')

  const notProven = projectOutcomeFromRun({
    runStatus: 'completed',
    effect: 'no-mutation',
    verification: 'inconclusive',
    acceptance: 'pending',
    reason: 'Nothing new to verify.',
  })
  assert.equal(notProven.status, 'not_proven')

  const external = projectOutcomeFromRun({
    runStatus: 'completed',
    effect: 'external-unknown',
    verification: 'pending',
    acceptance: 'pending',
    reason: 'External effect outcome unknown.',
  })
  assert.equal(external.status, 'not_proven')
})

test('a passed run outcome never completes the Work Unit by itself', () => {
  const result = bridgeConfirmedIdeaToExecution(baseIdea(), {
    spaceId: 'SPACE-bridge-test',
    idFactory: () => 'completion-gate',
  })
  if (result.status !== 'software-execution') throw new Error('expected software route')

  // The bridge Work Unit has no acceptance evidence yet; the completion
  // invariant must hold regardless of how well an execution run went.
  assert.equal(canMarkCompleted(result.workUnit), false)
})
