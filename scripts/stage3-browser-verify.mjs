#!/usr/bin/env node
/**
 * Stage 3 — real-browser acceptance for the daily-notes outcome.
 *
 * Drives the produced index.html in a REAL Chromium renderer (Electron) and
 * performs the round's acceptance journey:
 *
 *   open page, input exists, type "今天是第一天", save, shows
 *   -> reload, still there
 *   -> close window, reopen, still there (real localStorage persistence)
 *   -> add "今天是第二天", both entries present
 *   -> reload, both still present
 *
 * Usage:
 *   xvfb-run -a node scripts/stage3-browser-verify.mjs <index.html>
 */

import { _electron } from 'playwright-core'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const indexHtml = resolve(process.argv[2])
if (!process.argv[2]) {
  console.error('usage: node scripts/stage3-browser-verify.mjs <index.html>')
  process.exit(2)
}

let failures = 0
function check(condition, label, detail = '') {
  const ok = Boolean(condition)
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${detail ? ` (${detail})` : ''}`)
  if (!ok) failures += 1
}

const electronPath = resolve(root, 'node_modules/electron/dist/electron')
const userDataDir = mkdtempSync(join(tmpdir(), 'stage3-userdata-'))
const electronApp = await _electron.launch({
  executablePath: electronPath,
  args: [resolve(root, 'scripts/stage3-electron-main.mjs'), indexHtml],
  cwd: root,
  env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1', STAGE3_USER_DATA_DIR: userDataDir },
})

try {
  const window1 = await electronApp.firstWindow()
  await window1.waitForLoadState('domcontentloaded')

  check((await window1.locator('#entry').count()) === 1, '页面能打开，输入框存在')
  check((await window1.locator('#save').count()) === 1, '保存按钮存在')

  // Deterministic start: this run's journey begins from an empty record.
  await window1.evaluate(() => { localStorage.clear() })
  await window1.reload()
  await window1.waitForLoadState('domcontentloaded')

  await window1.fill('#entry', '今天是第一天')
  await window1.click('#save')
  let items = await window1.locator('#list li').allTextContents()
  check(
    items.length === 1 && items[0].trim() === '今天是第一天',
    '输入并点保存后，记录显示出来',
    JSON.stringify(items),
  )

  await window1.reload()
  await window1.waitForLoadState('domcontentloaded')
  items = await window1.locator('#list li').allTextContents()
  check(
    items.length === 1 && items[0].trim() === '今天是第一天',
    '刷新后记录还在',
    JSON.stringify(items),
  )

  // Close the window, reopen the app: localStorage must survive the reopen.
  await electronApp.evaluate(({ BrowserWindow }, { fileUrl }) => {
    BrowserWindow.getAllWindows().forEach((win) => win.destroy())
    const win = new BrowserWindow({
      width: 900,
      height: 700,
      show: false,
      webPreferences: { partition: 'persist:stage3' },
    })
    win.loadURL(fileUrl)
    return true
  }, { fileUrl: pathToFileURL(indexHtml).href })
  const window2 = await electronApp.waitForEvent('window')
  await window2.waitForLoadState('domcontentloaded')
  items = await window2.locator('#list li').allTextContents()
  check(
    items.length === 1 && items[0].trim() === '今天是第一天',
    '关闭后重新打开，记录还在',
    JSON.stringify(items),
  )

  await window2.fill('#entry', '今天是第二天')
  await window2.click('#save')
  items = await window2.locator('#list li').allTextContents()
  check(
    items.length === 2 && items[0].trim() === '今天是第一天' && items[1].trim() === '今天是第二天',
    '新增第二条后，两条记录都在',
    JSON.stringify(items),
  )

  await window2.reload()
  await window2.waitForLoadState('domcontentloaded')
  items = await window2.locator('#list li').allTextContents()
  check(
    items.length === 2 && items[0].trim() === '今天是第一天' && items[1].trim() === '今天是第二天',
    '两条记录在刷新后仍在',
    JSON.stringify(items),
  )
} finally {
  await electronApp.close()
  rmSync(userDataDir, { recursive: true, force: true })
}

console.log(
  failures === 0
    ? JSON.stringify({ browserVerify: 'stage3-daily-notes-pass' })
    : JSON.stringify({ browserVerify: 'stage3-daily-notes-fail', failures }),
)
process.exit(failures === 0 ? 0 : 1)
