/**
 * Stage 3 — Electron main used by stage3-browser-verify.mjs.
 *
 * Loads the produced daily-notes page from file:// in a real Chromium
 * renderer. The window stays hidden; the playwright-core driver drives it.
 * The process stays alive after all windows close so the driver can simulate
 * close-and-reopen of the app and confirm localStorage persistence.
 */

import { app, BrowserWindow } from 'electron'
import { pathToFileURL } from 'node:url'

// Isolate this run's persisted storage so the acceptance journey is
// deterministic even when previous runs left data behind.
if (process.env.STAGE3_USER_DATA_DIR) {
  app.setPath('userData', process.env.STAGE3_USER_DATA_DIR)
}

const indexHtml = process.argv[process.argv.length - 1]

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    show: false,
    webPreferences: { partition: 'persist:stage3' },
  })
  win.loadURL(pathToFileURL(indexHtml).href)
  return win
}

app.whenReady().then(() => {
  createWindow()
})

// A persistent named partition is used so localStorage survives window
// close/reopen within the same app instance (real persistence, not in-memory).
app.on('window-all-closed', () => {
  // Stay alive for the driver's close-and-reopen check.
})
