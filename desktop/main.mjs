import { app, BrowserWindow, Menu, dialog, ipcMain } from 'electron'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { resolveBackendScript, spawnBackend } from './backend.mjs'

const desktopDir = resolve(fileURLToPath(new URL('.', import.meta.url)))
const repoRoot = resolve(desktopDir, '..')

// The renderer may only ever talk to a loopback Workbench backend. Everything
// else is denied by the navigation/window/permission guards below.
const LOOPBACK_ORIGIN = /^http:\/\/127\.0\.0\.1:\d+$/

let win = null
let backend = null
let backendUrl = ''
let switching = false
let cleanShutdownDone = false

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

  const workbenchRoot = resolveWorkbenchRoot()
  const harnessCheckout = process.env.MING_HARNESS_CHECKOUT
    ? resolve(process.env.MING_HARNESS_CHECKOUT)
    : undefined

  const nodeBin = resolveNodeBin()
  const script = resolveBackendScriptPath(workbenchRoot)
  appendStartupLog(
    `backend spawn nodeBin=${nodeBin} script=${script} project=${projectRoot} harnessCheckout=${harnessCheckout ?? 'default'}`,
  )

  backend = spawnBackend({
    nodeBin,
    script,
    projectRoot,
    workbenchRoot,
    harnessCheckout,
  })

  backendUrl = await backend.ready
  appendStartupLog(`backend ready ${backendUrl}`)
  writeLastProject(projectRoot)
  return backendUrl
}

function isAllowedBackendUrl(url) {
  return LOOPBACK_ORIGIN.test(url)
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
    if (!isAllowedBackendUrl(targetUrl)) event.preventDefault()
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
  ipcMain.handle('desktop:select-project', async () => {
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
  ipcMain.on('desktop:quit', () => app.quit())
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
