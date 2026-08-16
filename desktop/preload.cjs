// Sandboxed preload. This is the ONLY bridge the renderer gets. It never
// exposes `require`, `process`, `ipcRenderer`, `fs`, `child_process`, or
// `shell` to the page — only the narrow Workbench Desktop API below.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('mingWorkbench', {
  // Open the OS directory picker and, on success, point Workbench at the new
  // project. Returns { canceled: boolean, url?: string }.
  selectProject: () => ipcRenderer.invoke('desktop:select-project'),
  // Ask the main process to shut the desktop app down cleanly.
  quit: () => ipcRenderer.send('desktop:quit'),
  // Provider secret management. The renderer never sees the plaintext key.
  hasProviderSecret: () => ipcRenderer.invoke('desktop:has-provider-secret'),
  setProviderSecret: (secret) => ipcRenderer.invoke('desktop:set-provider-secret', secret),
  // Remove the stored provider secret (safeStorage) and restart the backend.
  clearProviderSecret: () => ipcRenderer.invoke('desktop:clear-provider-secret'),
  // Non-secret provider preferences (provider/model/base URL). The API key is
  // never part of these — it lives only in safeStorage.
  getProviderPreferences: () => ipcRenderer.invoke('desktop:get-provider-preferences'),
  setProviderPreferences: (preferences) => ipcRenderer.invoke('desktop:set-provider-preferences', preferences),
  // Whether this renderer is running inside the Electron desktop shell.
  isDesktop: true,
  // Auto-update bridge. Renderer can query and trigger updates through IPC.
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-for-updates'),
  downloadUpdate: () => ipcRenderer.invoke('desktop:download-update'),
  installUpdate: () => ipcRenderer.invoke('desktop:install-update'),
  getUpdateStatus: () => ipcRenderer.invoke('desktop:update-status'),
  onUpdateAvailable: (callback) => ipcRenderer.on('desktop:update-available', (_e, info) => callback(info)),
  onUpdateReady: (callback) => ipcRenderer.on('desktop:update-ready', (_e, info) => callback(info)),
  onUpdateProgress: (callback) => ipcRenderer.on('desktop:update-progress', (_e, info) => callback(info)),
})
