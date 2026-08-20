import test from 'node:test'
import assert from 'node:assert/strict'

import {
  bridgeConfirmedIdeaToExecution,
  compileExecutableGoal,
  routeForConfirmedIdea,
  projectOutcomeFromRun,
} from '../.tmp/bridge/index.js'
import { canMarkCompleted } from '../.tmp/core/model.js'
import { resolveSoftwareExecutionCapability } from '../.tmp/capability/capability-resolution.js'

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
  assert.equal(result.workUnit.acceptance.length, result.goal.acceptanceCriteria.length)
  assert.deepEqual(
    result.workUnit.acceptance.map((criterion) => criterion.statement),
    result.goal.acceptanceCriteria,
  )
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

  const rejected = projectOutcomeFromRun({
    runStatus: 'completed',
    effect: 'mutation-observed',
    verification: 'passed',
    acceptance: 'rejected',
    reason: 'Human rejected the result after opening it.',
  })
  assert.equal(rejected.status, 'rejected')
  assert.match(rejected.summary, /拒绝/)

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

test('Capability Resolution V0 reuses the qualified chain and stays honest about portability', () => {
  const result = bridgeConfirmedIdeaToExecution(baseIdea(), {
    spaceId: 'SPACE-capability-test',
    idFactory: () => 'capability-id',
  })
  if (result.status !== 'software-execution') throw new Error('expected software route')

  const decision = resolveSoftwareExecutionCapability({
    workUnit: result.workUnit,
    harnessCheckout: process.cwd(),
  })
  assert.equal(decision.workUnitId, result.workUnit.id)
  assert.equal(decision.capabilityNeed, 'bounded software execution with independently verifiable mutation')
  assert.equal(decision.assessment.sufficient, true)
  assert.equal(decision.discoveryStatus, 'NOT_REQUIRED')
  assert.equal(decision.resolution?.implementation, 'Harness ACP adapter')
  assert.equal(decision.executorPortability, 'NOT_PROVEN')
  assert.match(decision.resolution?.reason ?? '', /Existing qualified capabilities were sufficient/)
})

test('Capability Resolution V0 does not fabricate discovery when Harness is unavailable', () => {
  const result = bridgeConfirmedIdeaToExecution(baseIdea(), {
    spaceId: 'SPACE-capability-test',
    idFactory: () => 'capability-missing',
  })
  if (result.status !== 'software-execution') throw new Error('expected software route')

  const decision = resolveSoftwareExecutionCapability({
    workUnit: result.workUnit,
    harnessCheckout: 'C:/path/that/does/not/exist',
  })
  assert.equal(decision.assessment.sufficient, false)
  assert.equal(decision.discoveryStatus, 'NOT_PROVEN')
  assert.equal(decision.resolution, undefined)
})

test('routeForConfirmedIdea never routes on a software word that appears only in notDoing', () => {
  const idea = baseIdea({
    agreement: {
      willGet: '这一轮你会得到一份每周健身动作清单。',
      solves: '把你「不知道怎么安排锻炼动作」这件事理清楚。',
      whereSee: '做完之后，你照着清单练就行。',
      notDoing: '这一轮不做网页，也不做任何软件。',
    },
    synthesis: {
      desiredReality: '把「每周健身动作安排」这件事理清楚',
      strengths: ['你清楚地说了你想要什么'],
      path: ['先把核心定下来', '做出每周能照着执行的一份清单'],
      recommendation: '先做出一份你每周能照着执行的动作清单',
    },
  })
  const decision = routeForConfirmedIdea(idea)
  assert.equal(decision.route, 'unsupported')
  assert.deepEqual(decision.matchedOn, [])
})

test('routeForConfirmedIdea keeps routing software when a positive surface names it, even if notDoing also names a software exclusion', () => {
  const idea = baseIdea({
    agreement: {
      willGet: '这一轮你会得到一个能直接打开的「每日记录」网页。',
      solves: '把「每天记录一句话、之后还能翻回来」这件事做成。',
      whereSee: '做完之后，你在浏览器里打开这个网页就能用。',
      notDoing: '这一轮不做网页版聊天功能，也不做多设备同步。',
    },
  })
  const decision = routeForConfirmedIdea(idea)
  assert.equal(decision.route, 'software_development')
  assert.ok(decision.matchedOn.includes('网页'))
})

test('compileExecutableGoal keeps the notDoing boundary out of the goal statement but in the scope criteria', () => {
  const idea = baseIdea({
    agreement: {
      willGet: '这一轮你会得到一个能直接打开的「每日记录」网页。',
      solves: '把你心里「记录每天发生的事、之后还能翻回来」这件事，从想法变成一个用得上的网页。',
      whereSee: '做完之后，你在浏览器里打开这个网页就能用。',
      notDoing: '这一轮不做账号、不上传云端、不做多设备同步。',
    },
  })
  const goal = compileExecutableGoal(idea)
  assert.ok(!goal.goalStatement.includes('不做账号'), 'boundary must not leak into the goal statement')
  assert.ok(
    goal.acceptanceCriteria.some((criterion) => criterion === '范围：这一轮不做账号、不上传云端、不做多设备同步。'),
    'boundary is carried as a scope acceptance criterion',
  )
})

test('projectOutcomeFromRun never proves an outcome from a run that did not complete', () => {
  const outcome = projectOutcomeFromRun({
    runStatus: 'interrupted',
    effect: 'mutation-observed',
    verification: 'passed',
    acceptance: 'accepted',
    reason: 'The run was interrupted before completing.',
  })
  assert.equal(outcome.status, 'not_proven')

  const failedRun = projectOutcomeFromRun({
    runStatus: 'failed',
    effect: 'mutation-observed',
    verification: 'passed',
    acceptance: 'accepted',
    reason: 'The transport reported failure.',
  })
  assert.equal(failedRun.status, 'not_proven')
})
