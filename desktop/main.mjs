import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveBackendScript, spawnBackend } from './backend.mjs'
import { isAllowedBackendUrl, isTrustedDesktopSender, urlOrigin } from './validation.mjs'
import { prepareHarnessRuntime } from '../.tmp/hosts/harness-runtime.js'
import {
  loadProviderSecret,
  saveProviderSecret,
  clearProviderSecret,
  hasProviderSecret,
} from './provider-secret.mjs'
import {
  loadWorkUnitStore,
  saveWorkUnitStore,
  clearWorkUnitStore,
} from './work-unit-store.mjs'

const desktopDir = resolve(fileURLToPath(new URL('.', import.meta.url)))
const repoRoot = resolve(desktopDir, '..')

// Optional explicit user-data relocation (portable/testing isolation). Must run
// before the single-instance lock so each isolated launch gets its own lock,
// startup log, Work Unit store and safeStorage secrets.
const cliUserDataDir = cliArgValue('--user-data-dir')
if (cliUserDataDir) {
  app.setPath('userData', resolve(cliUserDataDir))
}

// The renderer may only ever talk to a loopback Workbench backend. Everything
// else is denied by the navigation/window/permission guards below.
const LOOPBACK_ORIGIN_RE = /^http:\/\/127\.0\.0\.1:\d+$/

let win = null
let backend = null
let backendUrl = ''
let activeBackendOrigin = ''
let switching = false
let cleanShutdownDone = false
let providerSecret = null
let workUnitStore = null
let currentProjectRoot = ''

// ── Auto-update ───────────────────────────────────────────────────────────
// electron-updater is loaded dynamically so dev mode (no release feed) does not
// crash. In packaged mode it checks GitHub Releases for the latest stable.
let autoUpdater = null
let updateInfo = null
let isDownloadingUpdate = false
let workUnitRunning = false

function tryLoadAutoUpdater() {
  if (!app.isPackaged) return null
  try {
    const { autoUpdater: au } = require('electron-updater')
    return au
  } catch {
    return null
  }
}

function setupAutoUpdater() {
  autoUpdater = tryLoadAutoUpdater()
  if (!autoUpdater) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('update-available', (info) => {
    updateInfo = info
    if (win && !win.isDestroyed()) {
      win.webContents.send('desktop:update-available', {
        version: info.version,
        releaseNotes: info.releaseNotes,
      })
    }
  })

  autoUpdater.on('update-not-available', () => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('desktop:update-not-available')
    }
  })

  autoUpdater.on('download-progress', (progress) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('desktop:update-progress', {
        percent: progress.percent,
      })
    }
  })

  autoUpdater.on('update-downloaded', (info) => {
    updateInfo = info
    isDownloadingUpdate = false
    if (win && !win.isDestroyed()) {
      win.webContents.send('desktop:update-ready', {
        version: info.version,
      })
    }
  })

  autoUpdater.on('error', (error) => {
    isDownloadingUpdate = false
    appendStartupLog(`auto-updater error: ${error?.message ?? String(error)}`)
  })

  // Quietly check for updates shortly after launch.
  setTimeout(() => {
    if (autoUpdater) {
      autoUpdater.checkForUpdates().catch(() => {})
    }
  }, 5000)
}

function checkForUpdatesNow() {
  if (!autoUpdater) {
    dialog.showMessageBox(win ?? undefined, {
      type: 'info',
      title: '检查更新',
      message: '当前环境不支持自动更新。',
      detail: '自动更新仅在已安装的桌面版中可用。',
    })
    return
  }
  autoUpdater.checkForUpdates().catch((error) => {
    dialog.showErrorBox('检查更新失败', error?.message ?? String(error))
  })
}

function downloadAndInstallUpdate() {
  if (!autoUpdater || isDownloadingUpdate || !updateInfo) return
  if (workUnitRunning) {
    dialog.showMessageBox(win ?? undefined, {
      type: 'warning',
      title: '更新已暂停',
      message: 'Workbench 正在执行工作单元，更新将在完成后进行。',
    })
    return
  }
  isDownloadingUpdate = true
  autoUpdater.downloadUpdate().catch((error) => {
    isDownloadingUpdate = false
    dialog.showErrorBox('下载更新失败', error?.message ?? String(error))
  })
}

function quitAndInstall() {
  if (!updateInfo || workUnitRunning) return
  autoUpdater.quitAndInstall(true, true)
}

function resolveWorkbenchRoot() {
  return app.isPackaged ? resolve(process.resourcesPath, 'app') : repoRoot
}

function resolveBackendScriptPath(workbenchRoot) {
  return resolveBackendScript(workbenchRoot)
}

/**
 * Dev mode runs the backend through Electron-as-node so no external Node is
 * required. Packaged mode prefers a system Node runtime for the sidecar and
 * falls back to Electron-as-node when Node is not installed.
 */
function resolveNodeBin() {
  if (!app.isPackaged) return process.execPath
  try {
    const probe = spawnSync('node', ['--version'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
    })
    if (probe.status === 0 && /^v\d+\./.test(probe.stdout ?? '')) return 'node'
  } catch {
    // Fall through to Electron-as-node.
  }
  return process.execPath
}

function statePath() {
  return join(app.getPath('userData'), 'workbench-state.json')
}

function startupLogPath() {
  return join(app.getPath('userData'), 'startup.log')
}

function appendStartupLog(line) {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(startupLogPath(), `${new Date().toISOString()} ${line}\n`, {
      flag: 'a',
    })
  } catch {
    // Startup logging is best-effort.
  }
}

function readLastProject() {
  try {
    const state = JSON.parse(readFileSync(statePath(), 'utf8'))
    return typeof state.lastProject === 'string' ? state.lastProject : undefined
  } catch {
    return undefined
  }
}

function writeLastProject(projectRoot) {
  try {
    mkdirSync(app.getPath('userData'), { recursive: true })
    writeFileSync(statePath(), `${JSON.stringify({ lastProject: projectRoot }, null, 2)}\n`, 'utf8')
  } catch {
    // Persisting the last project is best-effort; it must never block startup.
  }
}

async function startBackend(projectRoot) {
  if (backend) {
    const previous = backend
    backend = null
    await previous.kill()
  }

  // Clear origin atomically before spawning so no stale origin is accepted
  // while a new backend is starting.
  activeBackendOrigin = ''

  const workbenchRoot = resolveWorkbenchRoot()
  const harnessCheckout = process.env.MING_HARNESS_CHECKOUT
    ? resolve(process.env.MING_HARNESS_CHECKOUT)
    : undefined

  const nodeBin = resolveNodeBin()
  const script = resolveBackendScriptPath(workbenchRoot)
  appendStartupLog(
    `backend spawn nodeBin=${nodeBin} script=${script} project=${projectRoot} harnessCheckout=${harnessCheckout ?? 'auto-bundled'}`,
  )

  // Resolve the exact reviewed Harness checkout automatically:
  // 1) env var (backward compat)
  // 2) bundled git bundle extraction + identity verification + deps install
  let resolvedHarnessCheckout
  try {
    const runtime = await prepareHarnessRuntime({
      workbenchRoot,
      harnessCheckout,
    })
    resolvedHarnessCheckout = runtime.checkout
    appendStartupLog(
      `harness runtime ready source=${runtime.source} commit=${runtime.identity.commit}`,
    )
  } catch (error) {
    appendStartupLog(
      `harness runtime preparation failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    dialog.showErrorBox(
      'Ming Workbench 无法启动',
      `Harness runtime 未准备好。\n\n${error instanceof Error ? error.message : String(error)}\n\n请检查网络连接或运行 \`npm run harness:prepare\`。`,
    )
    app.quit()
    return
  }

  // The window may have been closed (app quitting) while the runtime was
  // preparing; never spawn a backend for a quitting app.
  if (cleanShutdownDone) return

  backend = spawnBackend({
    nodeBin,
    script,
    projectRoot,
    workbenchRoot,
    harnessCheckout: resolvedHarnessCheckout,
    storeDir: app.getPath('userData'),
    extraEnv: providerSecret ? { DEEPSEEK_API_KEY: providerSecret } : undefined,
  })

  backendUrl = await backend.ready
  // The window closed while the backend child was starting; kill the child
  // instead of leaving an orphaned backend behind.
  if (cleanShutdownDone) {
    const spawned = backend
    backend = null
    await spawned.kill()
    return
  }
  // Atomically set the exact backend origin BEFORE any renderer navigation or
  // IPC can observe it. Only the exact ready URL becomes trusted.
  activeBackendOrigin = urlOrigin(backendUrl) ?? ''
  currentProjectRoot = projectRoot
  appendStartupLog(`backend ready ${backendUrl} origin=${activeBackendOrigin}`)
  writeLastProject(projectRoot)
  return backendUrl
}

function checkNavigationAllowed(url) {
  return isAllowedBackendUrl(url, activeBackendOrigin)
}

function cliArgValue(name) {
  const index = process.argv.indexOf(name)
  const value = index >= 0 ? process.argv[index + 1] : undefined
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function hardenWindow(targetWin) {
  // The renderer can never open new windows or embed webviews.
  targetWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  targetWin.webContents.on('will-attach-webview', (event) => event.preventDefault())
  // Navigation is limited to the Workbench-owned loopback backend.
  targetWin.webContents.on('will-navigate', (event, targetUrl) => {
    if (!checkNavigationAllowed(targetUrl)) event.preventDefault()
  })
  // No browser permission (geolocation, media, notifications, etc.).
  targetWin.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  targetWin.webContents.session.setPermissionCheckHandler(() => false)
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 840,
    minWidth: 720,
    minHeight: 560,
    title: 'Ming Workbench',
    backgroundColor: '#f5f7fb',
    show: false,
    webPreferences: {
      preload: join(desktopDir, 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
    },
  })
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    win = null
  })
  win.webContents.on('did-finish-load', () => {
    // Scripted smoke verification signal. Not product UI.
    console.log('MING_DESKTOP_WINDOW_READY')
  })
  hardenWindow(win)
  return win
}

function buildMenu() {
  const template = [
    {
      label: '项目',
      submenu: [
        {
          label: '更换项目…',
          accelerator: 'CmdOrCtrl+O',
          click: () => {
            void requestProjectSwitch()
          },
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: 'CmdOrCtrl+Q',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '检查更新…',
          click: () => checkForUpdatesNow(),
        },
        { type: 'separator' },
        {
          label: '关于 Ming Workbench',
          click: () => {
            dialog.showMessageBox(win ?? undefined, {
              type: 'info',
              title: '关于 Ming Workbench',
              message: 'Ming Workbench',
              detail: `版本 ${app.getVersion()}\n\n把一句想法，变成看得见的工作。`,
            })
          },
        },
      ],
    },
  ]
  if (!app.isPackaged) {
    template.push({
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload' },
        { label: '开发者工具', role: 'toggleDevTools' },
      ],
    })
  }
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

async function pickProjectViaDialog() {
  const options = {
    title: '选择要交给 Ming Workbench 的本地项目',
    buttonLabel: '使用这个项目',
    properties: ['openDirectory', 'createDirectory'],
  }
  const result = win
    ? await dialog.showOpenDialog(win, options)
    : await dialog.showOpenDialog(options)
  if (result.canceled || result.filePaths.length === 0) return undefined
  return resolve(result.filePaths[0])
}

async function switchBackend(projectRoot) {
  // startBackend sets activeBackendOrigin atomically after backend.ready.
  const url = await startBackend(projectRoot)
  if (win && !win.isDestroyed()) {
    void win.loadURL(url)
  }
  return url
}

async function requestProjectSwitch() {
  if (switching) return
  switching = true
  try {
    const picked = await pickProjectViaDialog()
    if (!picked) return
    await switchBackend(picked)
  } catch (error) {
    dialog.showErrorBox(
      'Ming Workbench 无法切换项目',
      error instanceof Error ? error.message : String(error),
    )
  } finally {
    switching = false
  }
}

function registerIpc() {
  ipcMain.handle('desktop:select-project', async (event) => {
    if (!isTrustedDesktopSender(event.sender.getURL(), activeBackendOrigin)) {
      return { canceled: true }
    }
    if (switching) return { canceled: true }
    switching = true
    try {
      const picked = await pickProjectViaDialog()
      if (!picked) return { canceled: true }
      const url = await switchBackend(picked)
      return { canceled: false, url }
    } finally {
      switching = false
    }
  })

  ipcMain.handle('desktop:has-provider-secret', async (event) => {
    if (!isTrustedDesktopSender(event.sender.getURL(), activeBackendOrigin)) {
      return { hasSecret: false }
    }
    return { hasSecret: hasProviderSecret() }
  })

  ipcMain.handle('desktop:set-provider-secret', async (event, secret) => {
    if (!isTrustedDesktopSender(event.sender.getURL(), activeBackendOrigin)) {
      return { ok: false }
    }
    if (typeof secret !== 'string' || secret.length > 10_000) {
      return { ok: false }
    }
    try {
      saveProviderSecret(secret)
      providerSecret = secret
      // Hot activation: restart the backend for the same fixed project so the
      // new secret reaches the Harness child env without an app restart. The
      // restart is fire-and-forget so the IPC response is not blocked; when the
      // new backend is ready the window reloads and resumes persisted state.
      void restartBackendForProviderActivation().catch((error) => {
        appendStartupLog(
          `provider activation failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
      return { ok: true }
    } catch {
      return { ok: false }
    }
  })

  ipcMain.on('desktop:quit', (event) => {
    if (!isTrustedDesktopSender(event.sender.getURL(), activeBackendOrigin)) return
    app.quit()
  })

  // Auto-update IPC: renderer can request update actions via preload bridge.
  ipcMain.handle('desktop:check-for-updates', async (event) => {
    if (!isTrustedDesktopSender(event.sender.getURL(), activeBackendOrigin)) {
      return { ok: false }
    }
    if (autoUpdater) {
      await autoUpdater.checkForUpdates().catch(() => {})
    }
    return { ok: true, hasUpdate: Boolean(updateInfo) }
  })

  ipcMain.handle('desktop:download-update', async (event) => {
    if (!isTrustedDesktopSender(event.sender.getURL(), activeBackendOrigin)) {
      return { ok: false }
    }
    if (!autoUpdater || !updateInfo || isDownloadingUpdate) return { ok: false }
    isDownloadingUpdate = true
    autoUpdater.downloadUpdate().catch(() => { isDownloadingUpdate = false })
    return { ok: true }
  })

  ipcMain.handle('desktop:install-update', async (event) => {
    if (!isTrustedDesktopSender(event.sender.getURL(), activeBackendOrigin)) {
      return { ok: false }
    }
    if (!updateInfo || workUnitRunning) return { ok: false }
    quitAndInstall()
    return { ok: true }
  })

  ipcMain.handle('desktop:update-status', async (event) => {
    if (!isTrustedDesktopSender(event.sender.getURL(), activeBackendOrigin)) {
      return { ok: false }
    }
    return {
      ok: true,
      isPackaged: app.isPackaged,
      hasUpdate: Boolean(updateInfo),
      updateVersion: updateInfo?.version ?? null,
      isDownloading: isDownloadingUpdate,
      isDownloaded: Boolean(updateInfo && !isDownloadingUpdate),
    }
  })

  ipcMain.on('desktop:work-unit-running', (event, running) => {
    if (!isTrustedDesktopSender(event.sender.getURL(), activeBackendOrigin)) return
    workUnitRunning = Boolean(running)
  })
}

/**
 * Controlled backend restart after a provider secret change. The new child is
 * spawned with the updated DEEPSEEK_API_KEY in its env; the exact backend
 * origin is rotated atomically (same discipline as project switching). Once
 * ready, the renderer reloads so it picks up the fresh per-process request
 * token and resumes persisted Work Units with a fresh mutable-facts check.
 */
async function restartBackendForProviderActivation() {
  if (!currentProjectRoot) return
  if (switching) return
  switching = true
  try {
    const url = await startBackend(currentProjectRoot)
    if (win && !win.isDestroyed()) {
      win.webContents.reload()
    }
    appendStartupLog('provider activation complete; backend restarted with updated provider secret')
    return url
  } finally {
    switching = false
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', (event) => {
    if (cleanShutdownDone) return
    if (!backend) {
      cleanShutdownDone = true
      return
    }
    event.preventDefault()
    const current = backend
    backend = null
    current
      .kill()
      .catch(() => {})
      .finally(() => {
        cleanShutdownDone = true
        app.quit()
      })
  })

  app.whenReady().then(async () => {
    app.setName('Ming Workbench')
    buildMenu()
    registerIpc()

    // Start auto-updater (no-op in dev mode).
    setupAutoUpdater()

    // Load persisted state for resume.
    workUnitStore = loadWorkUnitStore()
    // Load provider secret from Electron safeStorage (single authority path).
    providerSecret = loadProviderSecret()

    appendStartupLog(`app ready packaged=${app.isPackaged} node=${process.version} execPath=${process.execPath}`)

    let projectRoot = cliArgValue('--project')
    if (projectRoot && !existsSync(projectRoot)) {
      dialog.showErrorBox(
        'Ming Workbench 无法启动',
        `--project 指向的目录不存在：${projectRoot}`,
      )
      app.quit()
      return
    }
    if (!projectRoot) {
      projectRoot = readLastProject()
      if (projectRoot && !existsSync(projectRoot)) projectRoot = undefined
    }
    if (!projectRoot) {
      projectRoot = await pickProjectViaDialog()
      if (!projectRoot) {
        app.quit()
        return
      }
    }
    appendStartupLog(`project fixed ${projectRoot}`)

    createWindow()
    try {
      const url = await startBackend(projectRoot)
      if (win && !win.isDestroyed()) {
        void win.loadURL(url)
      }
    } catch (error) {
      appendStartupLog(`backend startup failed: ${error instanceof Error ? error.message : String(error)}`)
      dialog.showErrorBox(
        'Ming Workbench 无法启动',
        `Workbench 后端没有准备好。\n\n${error instanceof Error ? error.message : String(error)}\n\n先运行 \`npm run build:test\` 和 \`npm run harness:prepare\`。`,
      )
      app.quit()
    }
  })
}
