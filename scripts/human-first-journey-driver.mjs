#!/usr/bin/env node
/**
 * Human-First Journey Driver — drives the REAL human-first V1 entry through the
 * Chrome DevTools Protocol (as a human would: click, type, wait).
 *
 * This is the automation layer for the human-first acceptance gate. It connects
 * to a running installed Ming Workbench desktop window started with NO --project
 * (fresh userData) and performs REAL user gestures against the DOM:
 *   - letter appears (never a project picker / engineering console)
 *   - 开始 works
 *   - exactly three human entry choices exist
 *   - an ordinary-language idea is typed and sent
 *   - more than one conversation turn
 *   - synthesis is grounded in the conversation
 *   - larger direction/map is human-facing (not a ticket UI)
 *   - exactly one smallest complete real outcome recommended
 *   - round agreement contains the four required semantics
 *   - normal pre-confirmation UI hides engineering concepts
 *
 * Phase "first" walks letter -> entry -> conversation -> review -> agreement ->
 * confirmed. Phase "second" relaunches the SAME userData and asserts the
 * confirmation + agreement persisted and are rendered through the UI.
 */

import { chromium } from 'playwright-core'

const CDP_URL = process.env.MING_CDP_URL ?? 'http://127.0.0.1:9222'
const PHASE = process.env.MING_JOURNEY_PHASE ?? 'first'
const IDEA_TEXT_1 = process.env.MING_IDEA_TEXT_1 ?? '我想做一个给家里人整理菜谱的简单工具'
const IDEA_TEXT_2 = process.env.MING_IDEA_TEXT_2 ?? '最重要的是家里老人也能一眼看懂怎么用'

// Normal pre-confirmation UI must never surface these engineering concepts.
const ENGINEERING_TERMS = [
  'Git', 'repo', 'AAOP', 'Harness', 'Agent', 'MCP', 'provider', 'Provider',
  'model', 'API', 'Key', 'Work Unit', 'branch', 'CI', 'terminal', 'npm',
  'node', '选择项目', '项目文件夹', '配置 AI',
]

const ENTRY_LABELS = ['我已经有一个想法', '我只有一点模糊念头', '我现在也不知道想做什么']

function step(name) {
  console.log(`=== ${name} ===`)
}

function assert(condition, label) {
  if (!condition) {
    console.error(`FAIL: ${label}`)
    process.exitCode = 1
    throw new Error(`human-first journey assertion failed: ${label}`)
  }
  console.log(`PASS: ${label}`)
}

async function click(page, selector, label) {
  const el = page.locator(selector)
  await el.waitFor({ state: 'visible', timeout: 15_000 })
  await el.click()
  console.log(`clicked ${label} (${selector})`)
}

async function waitForText(page, text, timeout = 30_000) {
  await page.waitForFunction(
    (t) => document.body && document.body.textContent.includes(t),
    text,
    { timeout },
  )
  console.log(`observed text: ${text}`)
}

async function assertNoEngineeringTerms(page) {
  const text = await page.evaluate(() => document.body.textContent)
  const hits = ENGINEERING_TERMS.filter((term) => text.includes(term))
  assert(hits.length === 0, `normal pre-confirmation UI hides engineering concepts (hits: ${hits.join(', ') || 'none'})`)
}

async function connectPage(browser) {
  const context = browser.contexts()[0]
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 3000))
  let page = null
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline && !page) {
    for (const candidate of context.pages()) {
      const url = candidate.url()
      if (/^http:\/\/127\.0\.0\.1:\d+/.test(url)) {
        page = candidate
        break
      }
    }
    if (!page) await new Promise((resolvePromise) => setTimeout(resolvePromise, 2000))
  }
  if (!page) {
    page = context.pages()[0]
  }
  await page.bringToFront()
  console.log(`connected to page: ${page.url()}`)
  return page
}

async function firstPhase(page) {
  step('1. first letter appears (fresh userData, no project)')
  await page.waitForSelector('#letter-view:not(.hidden)', { timeout: 30_000 })
  const letterTitle = await page.locator('#letter-view h1').textContent()
  console.log(`letter title: ${letterTitle}`)
  assert(letterTitle.trim().length > 0, 'first letter appears')
  assert((await page.locator('#start-button').isVisible()), '开始 button visible')
  assert((await page.locator('#pick-project').count()) === 0, 'old project-first welcome page does NOT return')

  step('2. 开始 works')
  await click(page, '#start-button', '开始')
  await page.waitForSelector('#entry-view:not(.hidden)', { timeout: 10_000 })
  await assertNoEngineeringTerms(page)

  step('3. exactly three human entry choices')
  for (const label of ENTRY_LABELS) {
    await waitForText(page, label)
  }
  const entryButtons = page.locator('.choice')
  assert((await entryButtons.count()) === 3, 'exactly 3 entry choices exist')
  const labels = await entryButtons.allTextContents()
  assert(JSON.stringify(labels) === JSON.stringify(ENTRY_LABELS), `entry labels are exact (${labels.join(' / ')})`)

  step('4. ordinary-language idea entered through real UI')
  await click(page, '.choice[data-entry="我已经有一个想法"]', 'entry: 我已经有一个想法')
  await page.waitForSelector('#conversation-view:not(.hidden)', { timeout: 10_000 })

  step('5. more than one conversation turn')
  async function send(text) {
    await page.locator('#message-input').fill(text)
    await page.locator('#send-button').click()
    await page.waitForFunction(
      (t) => [...document.querySelectorAll('.bubble.human')].some((b) => b.textContent.includes(t)),
      text,
      { timeout: 60_000 },
    )
    console.log(`sent: ${text}`)
  }
  await send(IDEA_TEXT_1)
  await send(IDEA_TEXT_2)

  step('6. synthesis is grounded in the conversation')
  await page.waitForSelector('#review-view:not(.hidden)', { timeout: 30_000 })
  const reviewRecommendation = await page.locator('#review-recommendation').textContent()
  console.log(`recommendation: ${reviewRecommendation}`)
  assert(reviewRecommendation.trim().length > 0, 'recommendation rendered')
  // Grounded: the recommendation references what the person actually said.
  const reference = IDEA_TEXT_1.replace(/[，。！？、]/g, '').slice(0, 8)
  assert(reviewRecommendation.includes(reference), 'synthesis is grounded in the conversation')
  const desiredReality = await page.locator('#review-desired').textContent()
  assert(desiredReality.includes(reference), 'desired reality grounded in conversation')

  step('7. larger direction/map is human-facing (not a ticket UI)')
  assert((await page.locator('#review-path li').count()) > 0, 'path steps rendered as human-facing list')
  const pathText = await page.locator('#review-path').textContent()
  assert(!/工单|ticket|任务编号|状态机/.test(pathText), 'direction/map is human language, not ticket UI')
  await assertNoEngineeringTerms(page)

  step('8. exactly one smallest complete real outcome recommended')
  const recCount = await page.locator('#review-recommendation').count()
  assert(recCount === 1, 'exactly one recommendation block')
  assert(reviewRecommendation.trim().length >= 4, 'recommendation is a real outcome sentence')

  step('9. round agreement contains the four required semantics')
  await click(page, '#review-next-button', '再看看这一轮要做什么')
  await page.waitForSelector('#agreement-view:not(.hidden)', { timeout: 30_000 })
  for (const [id, label] of [
    ['#agreement-willget', '这一轮会得到什么'],
    ['#agreement-solves', '它解决什么问题'],
    ['#agreement-wheresee', '你会在哪里看到 / 怎么使用它'],
    ['#agreement-notdoing', '这一轮明确不做什么'],
  ]) {
    await waitForText(page, label)
    const value = await page.locator(id).textContent()
    assert(value.trim().length > 0, `agreement semantic present: ${label}`)
  }

  step('10. confirmation via the real UI')
  await click(page, '#agreement-confirm-button', '对，就是这个，开始吧')
  await page.waitForSelector('#confirmed-view:not(.hidden)', { timeout: 15_000 })
  const confirmedRecommendation = await page.locator('#confirmed-recommendation').textContent()
  assert(confirmedRecommendation.trim().length > 0, 'confirmation view shows the agreed outcome')
  assert(confirmedRecommendation.includes(reference), 'confirmation references the grounded outcome')
}

async function secondPhase(page) {
  step('1. confirmation persists after close/reopen')
  await page.waitForSelector('#confirmed-view:not(.hidden)', { timeout: 30_000 })
  const confirmedRecommendation = await page.locator('#confirmed-recommendation').textContent()
  console.log(`restored recommendation: ${confirmedRecommendation}`)
  assert(confirmedRecommendation.trim().length > 0, 'confirmed outcome restored through the UI')
  const willGet = await page.locator('#agreement-willget').textContent()
  assert(willGet.trim().length > 0, 'round agreement restored through the UI')
  assert(!(await page.locator('#letter-view').isVisible()), 'does not restart at the letter after confirmation')
  await assertNoEngineeringTerms(page)
}

async function main() {
  const browser = await chromium.connectOverCDP(CDP_URL)
  const page = await connectPage(browser)
  try {
    if (PHASE === 'second') {
      await secondPhase(page)
    } else {
      await firstPhase(page)
    }
    console.log(`HUMAN_FIRST_JOURNEY_${PHASE.toUpperCase()}_OK`)
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
