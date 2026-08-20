import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

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
  loadProviderPreferences,
  saveProviderPreferences,
  defaultProviderPreferences,
} from './preferences.mjs'
import {
  loadWorkUnitStore,
  saveWorkUnitStore,
  clearWorkUnitStore,
} from './work-unit-store.mjs'

const desktopDir = resolve(fileURLToPath(new URL('.', import.meta.url)))
const repoRoot = resolve(desktopDir, '..')

// Optional explicit user-data relocation (portable/testing isolation). Must run
// before the single-instance lock so each isolated launch gets its own lock,
// startup log, Work Unit store and safeStorage secrets. The env override is
// for automated verification (CDP sessions where --user-data-dir is consumed
// by the Chromium command line); the CLI flag takes precedence.
const cliUserDataDir = cliArgValue('--user-data-dir')
const envUserDataDir = process.env.MING_WORKBENCH_USER_DATA
const resolvedUserDataDir = cliUserDataDir ?? (envUserDataDir ? resolve(envUserDataDir) : undefined)
if (resolvedUserDataDir) {
  app.setPath('userData', resolvedUserDataDir)
}

// The renderer may only ever talk to a loopback Workbench backend. Everything
// else is denied by the navigation/window/permission guards below.
const LOOPBACK_ORIGIN_RE = /^http:\/\/127\.0\.0\.1:\d+$/

let win = null
let backend = null
let backendUrl = ''
let activeBackendOrigin = ''
let switching = false
let pendingRestart = false
let cleanShutdownDone = false
let providerSecret = null
let providerPreferences = defaultProviderPreferences()
let workUnitStore = null
let currentProjectRoot = ''
// Startup diagnostics: track backend lifecycle for regression diagnosis.
let backendRunId = 0
let lastRestartReason = ''
let backendStartTs = 0
let backendStarting = false

// ── Auto-update ───────────────────────────────────────────────────────────
// electron-updater is loaded dynamically so dev mode (no release feed) does not
// crash. In packaged mode it checks GitHub Releases for the latest stable.
let autoUpdater = null
let updateInfo = null
let isDownloadingUpdate = false

// ── B2: Execution state authority ─────────────────────────────────────────
// The renderer is NOT the execution truth owner.  The authoritative source for
// "is a Work Unit executing right now?" is the persisted Work Unit store that
// the backend writes to.  The renderer may *display* execution status, but it
// may not *decide* it.  We re-read the shared store before any install.
const EXECUTING_STATES = new Set(['running', 'verifying'])

function isExecutionActiveFromStore() {
  if (!workUnitStore) return false
  const store = loadWorkUnitStore()
  return store.workUnits.some((w) => EXECUTING_STATES.has(w.state))
}

function tryLoadAutoUpdater() {
  if (!app.isPackaged) return null
  try {
    // electron-updater is ESM — require() does not work in an ESM main.
    // Use createRequire to load it from node_modules in the packaged app.
    const requireFromApp = createRequire(desktopDir + '/')
    const { autoUpdater: au } = requireFromApp('electron-updater')
    if (!au || typeof au.checkForUpdates !== 'function') {
      throw new Error('electron-updater loaded but autoUpdater API is missing')
    }
    return au
  } catch (error) {
    appendStartupLog(
      `auto-updater load failed: ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

function setupAutoUpdater() {
  const isCI = process.env.GITHUB_ACTIONS || process.env.CI

  const loaded = tryLoadAutoUpdater()
  if (!loaded) return
  autoUpdater = loaded
  appendStartupLog(`auto-updater loaded: ${autoUpdater.constructor?.name ?? typeof autoUpdater}`)

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

  // In CI environments, skip checkForUpdates because there are no published
  // versions and the network check would fail. The module is still loaded and
  // the event handlers are attached (they won't fire without checkForUpdates).
  if (isCI) {
    appendStartupLog('auto-updater: checkForUpdates skipped in CI (module loaded, handlers attached)')
    return
  }

  // Quietly check for updates shortly after launch.
  setTimeout(() => {
    if (autoUpdater) {
      try {
        autoUpdater.checkForUpdates().catch(() => {})
      } catch {
        // Defensive: electron-updater may throw synchronously in some paths
        appendStartupLog('auto-updater: synchronous checkForUpdates error caught')
      }
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
  // B2: check the authoritative backend store, not the renderer boolean.
  if (isExecutionActiveFromStore()) {
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
  if (!updateInfo) return
  // B2: re-read the authoritative store right before install — the renderer
  // boolean is never the gate.
  if (isExecutionActiveFromStore()) return
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

async function startBackend(projectRoot, reason = 'initial') {
  backendRunId += 1
  const runId = backendRunId
  backendStartTs = Date.now()
  lastRestartReason = reason
  const hasProject = Boolean(projectRoot)
  const hasProvider = Boolean(providerSecret)
  backendStarting = true
  appendStartupLog(
    `[backend-run-${runId}] start reason=${reason} mode=${hasProject ? 'project' : 'human-first'} projectRoot=${hasProject ? 'set' : 'none'} providerConfigured=${hasProvider} prefsModel=${providerPreferences.model || 'none'}`,
  )

  if (backend) {
    const previous = backend
    backend = null
    appendStartupLog(`[backend-run-${runId}] killing previous backend`)
    await previous.kill()
    appendStartupLog(`[backend-run-${runId}] previous backend killed`)
  }

  // Clear origin atomically before spawning so no stale origin is accepted
  // while a new backend is starting.
  activeBackendOrigin = ''

  const workbenchRoot = resolveWorkbenchRoot()
  const nodeBin = resolveNodeBin()
  const script = resolveBackendScriptPath(workbenchRoot)

  // Project mode needs the reviewed Harness runtime for its read-only intake.
  // Human-first deliberately defers runtime verification/extraction until
  // after the person confirms a round and asks to execute; startup itself must
  // not perform execution-side preparation or external work.
  let resolvedHarnessCheckout
  const harnessCheckout = process.env.MING_HARNESS_CHECKOUT
    ? resolve(process.env.MING_HARNESS_CHECKOUT)
    : undefined
  appendStartupLog(
    `backend spawn nodeBin=${nodeBin} script=${script} project=${projectRoot ?? 'none'} harnessCheckout=${harnessCheckout ?? 'auto-bundled'}`,
  )
  if (hasProject) {
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
      // B4: packaged error messages must never show npm/node/terminal commands.
      const userMessage = app.isPackaged
        ? 'Ming Workbench 需要准备运行环境，但未能完成。\n\n请检查安装是否完整后重新启动。'
        : `Harness runtime 未准备好。\n\n${error instanceof Error ? error.message : String(error)}\n\n请检查网络连接或运行 \`npm run harness:prepare\`。`
      dialog.showErrorBox(
        'Ming Workbench 无法启动',
        userMessage,
      )
      app.quit()
      return
    }
  } else {
    appendStartupLog('human-first V1 entry: deferring Harness runtime preparation until confirmed execution')
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
    extraArgs: projectRoot ? [] : ['--mode', 'human-first'],
    extraEnv: {
      ...(providerSecret ? { DEEPSEEK_API_KEY: providerSecret } : {}),
      // User-configurable provider/model (non-secret preferences) reach the
      // backend child env and flow into the Harness ACP child. A custom
      // OpenAI-compatible endpoint rides DEEPSEEK_BASE_URL (the harness
      // plugin reads it natively); official DeepSeek leaves it unset.
      MING_HARNESS_PROVIDER: providerPreferences.provider,
      MING_HARNESS_MODEL: providerPreferences.model,
      ...(providerPreferences.baseUrl
        ? {
            DEEPSEEK_BASE_URL: providerPreferences.baseUrl,
            // Third-party OpenAI-compatible endpoints accept the common
            // reasoning vocabulary but not DeepSeek's max/off; the harness
            // plugin requires effort "off" together with thinking disabled,
            // which omits the field entirely (endpoint defaults apply).
            MING_HARNESS_THINKING: 'disabled',
            MING_HARNESS_REASONING_EFFORT: 'off',
            // Third-party endpoints cap max_tokens well below DeepSeek's
            // 256000 default (e.g. SenseNova: 65536); 16384 is safe across
            // OpenAI-compatible providers.
            MING_HARNESS_MAX_TOKENS: '16384',
          }
        : {}),
      // Repository-owned deterministic installed journeys may opt into the
      // fixture executor through a process-level marker. The renderer still
      // has to reach the normal confirmation/cost-gate UI; the marker is not
      // user-configurable and is never accepted from a request body alone.
      ...(process.env.MING_EXECUTION_FIXTURE === '1'
        ? { MING_EXECUTION_FIXTURE: '1' }
        : {}),
    },
  })

  const readyTs = Date.now()
  backendUrl = await backend.ready
  // The window closed while the backend child was starting; kill the child
  // instead of leaving an orphaned backend behind.
  if (cleanShutdownDone) {
    const spawned = backend
    backend = null
    backendStarting = false
    appendStartupLog(`[backend-run-${runId}] window closed during startup; killing spawned backend`)
    await spawned.kill()
    return
  }
  // Atomically set the exact backend origin BEFORE any renderer navigation or
  // IPC can observe it. Only the exact ready URL becomes trusted.
  activeBackendOrigin = urlOrigin(backendUrl) ?? ''
  currentProjectRoot = projectRoot
  const elapsedMs = readyTs - backendStartTs
  backendStarting = false
  appendStartupLog(
    `backend ready ${backendUrl} origin=${activeBackendOrigin} mode=${projectRoot ? 'project' : 'human-first'} runId=${runId} startupMs=${elapsedMs}`,
  )
  if (projectRoot) writeLastProject(projectRoot)
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
  appendStartupLog(`switchBackend called projectRoot=${projectRoot || 'none'}`)
  const url = await startBackend(projectRoot, 'project-switch')
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

/**
 * Trusted sender for desktop-only actions. Normal mode accepts only the exact
 * loopback backend origin. Before any project exists, the local welcome page
 * (file:) may open the OS folder picker — nothing else is exposed to it.
 */
function isTrustedDesktopSenderForAction(sender) {
  if (isTrustedDesktopSender(sender.getURL(), activeBackendOrigin)) return true
  return (
    activeBackendOrigin === ''
    && sender === (win ? win.webContents : undefined)
    && sender.getURL().startsWith('file:')
  )
}

function registerIpc() {
  ipcMain.handle('desktop:select-project', async (event) => {
    if (!isTrustedDesktopSenderForAction(event.sender)) {
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

  ipcMain.handle('desktop:get-provider-preferences', async (event) => {
    if (!isTrustedDesktopSender(event.sender.getURL(), activeBackendOrigin)) {
      return { ok: false }
    }
    return { ok: true, preferences: providerPreferences }
  })

  ipcMain.handle('desktop:set-provider-preferences', async (event, preferences) => {
    if (!isTrustedDesktopSender(event.sender.getURL(), activeBackendOrigin)) {
      return { ok: false }
    }
    if (!preferences || typeof preferences !== 'object') {
      return { ok: false, message: '配置格式不正确。' }
    }
    try {
      const saved = saveProviderPreferences(preferences)
      providerPreferences = saved
      appendStartupLog(`IPC set-provider-preferences: model=${saved.model || 'none'} baseUrl=${saved.baseUrl || 'none'}`)
      void restartBackendForProviderActivation('set-preferences').catch((error) => {
        appendStartupLog(
          `provider preferences activation failed: ${error instanceof Error ? error.message : String(error)}`,
        )
      })
      return { ok: true, preferences: saved }
    } catch {
      return { ok: false, message: '配置没有保存成功，请稍后重试。' }
    }
  })

  ipcMain.handle('desktop:clear-provider-secret', async (event) => {
    if (!isTrustedDesktopSender(event.sender.getURL(), activeBackendOrigin)) {
      return { ok: false }
    }
    clearProviderSecret()
    providerSecret = null
    appendStartupLog(`IPC clear-provider-secret: secret cleared`)
    void restartBackendForProviderActivation('clear-secret').catch((error) => {
      appendStartupLog(
        `provider secret clear failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    })
    return { ok: true }
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
      appendStartupLog(`IPC set-provider-secret: secret saved (len=${secret.length})`)
      // Hot activation: restart the backend for the same fixed project so the
      // new secret reaches the Harness child env without an app restart. The
      // restart is fire-and-forget so the IPC response is not blocked; when the
      // new backend is ready the window reloads and resumes persisted state.
      void restartBackendForProviderActivation('set-secret').catch((error) => {
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
    if (!updateInfo) return { ok: false }
    // B2: the authoritative check is in quitAndInstall itself.
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
}

/**
 * Controlled backend restart after a provider secret change. The new child is
 * spawned with the updated DEEPSEEK_API_KEY in its env; the exact backend
 * origin is rotated atomically (same discipline as project switching). Once
 * ready, the renderer reloads so it picks up the fresh per-process request
 * token and resumes persisted Work Units with a fresh mutable-facts check.
 */
async function restartBackendForProviderActivation(reason = 'provider-change') {
  // A restart may already be in flight (e.g. saving the secret and the
  // preferences each trigger one). Do not drop the second request: mark it
  // pending and run it once the current restart finishes, so the LAST saved
  // configuration (including a custom base URL) actually reaches the backend.
  // Works for both project mode and human-first mode (no project).
  appendStartupLog(
    `restartBackendForProviderActivation called reason=${reason} switching=${switching} currentProjectRoot=${currentProjectRoot || 'none'}`,
  )
  if (switching) {
    pendingRestart = true
    appendStartupLog(`restart queued (pendingRestart=true)`)
    return
  }
  switching = true
  try {
    const url = await startBackend(currentProjectRoot, reason)
    if (win && !win.isDestroyed()) {
      // The backend restart binds a NEW loopback port; reloading the stale
      // URL would land on a connection-refused error page. Navigate to the
      // fresh origin instead.
      void win.loadURL(url)
    }
    appendStartupLog(`provider activation complete reason=${reason}; backend restarted with updated provider secret`)
    return url
  } finally {
    switching = false
    if (pendingRestart) {
      pendingRestart = false
      appendStartupLog(`pending restart executing after previous completion`)
      void restartBackendForProviderActivation('pending-provider-change')
    }
  }
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    // A second launch with the shutdown marker is the deterministic close
    // channel: WM_CLOSE can fail to reach the window (observed on an
    // installed build), so the smoke scripts can always request a clean
    // close through the single-instance lock instead.
    if (argv && argv.some((a) => a === '--mw-close-instance')) {
      if (win && !win.isDestroyed()) win.close()
      else app.quit()
      return
    }
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
    // If a backend restart is in progress, wait for it to complete so we
    // don't quit with a null backend (which would skip cleanup).
    if (backendStarting || switching) {
      appendStartupLog('close requested during backend restart; waiting for completion')
      event.preventDefault()
      const waitStart = Date.now()
      const waitGuard = setTimeout(() => {
        appendStartupLog('backend restart did not complete within 5s during close; proceeding')
        backendStarting = false
        switching = false
        // After timeout, fall through to the normal close path
        performClose()
      }, 5000)
      const waitTick = setInterval(() => {
        if (!backendStarting && !switching) {
          clearInterval(waitTick)
          clearTimeout(waitGuard)
          performClose()
        }
      }, 100)
      return
    }
    performClose()
  })

  function performClose() {
    if (cleanShutdownDone) return
    if (!backend) {
      cleanShutdownDone = true
      appendStartupLog('close: no backend to clean up')
      return
    }
    const current = backend
    backend = null
    appendStartupLog('close: killing backend tree')
    // Bounded clean close: a backend tree kill must never block the window
    // close. Work Units are persisted on every state change, so a forced exit
    // loses nothing; if the kill stalls, exit anyway within the bound.
    const killGuard = setTimeout(() => {
      appendStartupLog('backend kill stalled; forcing app exit')
      cleanShutdownDone = true
      app.exit(0)
    }, 5000)
    current
      .kill()
      .catch(() => {})
      .finally(() => {
        clearTimeout(killGuard)
        cleanShutdownDone = true
        appendStartupLog('close: backend killed; quitting')
        app.quit()
      })
  }

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
    // Load non-secret provider preferences (provider/model/base URL).
    providerPreferences = loadProviderPreferences()

    appendStartupLog(`app ready packaged=${app.isPackaged} node=${process.version} execPath=${process.execPath} providerSecretLoaded=${Boolean(providerSecret)} prefsModel=${providerPreferences.model || 'none'}`)

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

    createWindow()
    if (!projectRoot) {
      // Human-first V1 entry: fresh userData / no project opens the human-facing
      // letter, never a project picker and never an engineering console. The
      // human-first backend needs no repository and no Harness runtime.
      appendStartupLog('no project; entering human-first V1 entry')
      try {
        const url = await startBackend(undefined, 'human-first-entry')
        if (win && !win.isDestroyed()) {
          void win.loadURL(url)
        }
      } catch (error) {
        appendStartupLog(`human-first backend startup failed: ${error instanceof Error ? error.message : String(error)}`)
        const userMessage = app.isPackaged
          ? 'Ming Workbench 没有准备好。\n\n请重新启动。如果问题持续，请检查安装是否完整。'
          : `Ming Workbench 没有准备好。\n\n${error instanceof Error ? error.message : String(error)}`
        dialog.showErrorBox(
          'Ming Workbench 无法启动',
          userMessage,
        )
        app.quit()
      }
      return
    }
    appendStartupLog(`project fixed ${projectRoot}`)

    try {
      const url = await startBackend(projectRoot, 'project-entry')
      if (win && !win.isDestroyed()) {
        void win.loadURL(url)
      }
    } catch (error) {
      appendStartupLog(`backend startup failed: ${error instanceof Error ? error.message : String(error)}`)
      // B4: packaged error messages must never show npm/node/terminal commands.
      const userMessage = app.isPackaged
        ? 'Ming Workbench 后端没有准备好。\n\n请重新启动。如果问题持续，请检查安装是否完整。'
        : `Workbench 后端没有准备好。\n\n${error instanceof Error ? error.message : String(error)}\n\n先运行 \`npm run build:test\` 和 \`npm run harness:prepare\`。`
      dialog.showErrorBox(
        'Ming Workbench 无法启动',
        userMessage,
      )
      app.quit()
    }
  })
}
