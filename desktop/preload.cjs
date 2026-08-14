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
})

// Small desktop-only affordance so a normal user can switch the fixed project
// from inside the window without touching the shared Stage B UI.
function injectSwitchProjectButton() {
  if (window.__mingWorkbenchSwitchButtonInjected) return
  window.__mingWorkbenchSwitchButtonInjected = true

  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = '更换项目'
  button.setAttribute(
    'style',
    'position:fixed;right:18px;bottom:18px;z-index:100;font:700 13px/1 Inter,ui-sans-serif,system-ui,sans-serif;color:#172033;background:#fff;border:1px solid #cfd7e5;border-radius:999px;padding:9px 14px;cursor:pointer;box-shadow:0 8px 24px rgba(43,55,78,.14);',
  )
  button.addEventListener('click', async () => {
    button.disabled = true
    try {
      const result = await window.mingWorkbench.selectProject()
      if (result && !result.canceled && result.url) {
        window.location.href = result.url
      }
    } finally {
      button.disabled = false
    }
  })
  document.body.appendChild(button)
}

if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', injectSwitchProjectButton)
} else {
  injectSwitchProjectButton()
}
