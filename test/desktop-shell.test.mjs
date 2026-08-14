import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  parseBackendReadyLine,
  resolveBackendScript,
} from '../desktop/backend.mjs'

function read(relative) {
  return readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
}

test('backend handshake parser accepts only the loopback ready line', () => {
  assert.equal(
    parseBackendReadyLine('MING_WORKBENCH_READY http://127.0.0.1:54321'),
    'http://127.0.0.1:54321',
  )
  assert.equal(parseBackendReadyLine('  open: http://127.0.0.1:1'), undefined)
  assert.equal(parseBackendReadyLine('MING_WORKBENCH_READY http://evil.example:1'), undefined)
  assert.equal(parseBackendReadyLine(''), undefined)
})

test('backend script path points at the existing shared launcher', () => {
  const script = resolveBackendScript(process.cwd())
  assert.match(script, /scripts[\\/]start-local-web\.mjs$/)
  const source = read('scripts/start-local-web.mjs')
  assert.match(source, /MING_WORKBENCH_READY/)
})

test('backend tree-kill uses a forced tree kill on Windows', () => {
  const source = read('desktop/backend.mjs')
  assert.match(source, /taskkill/)
  assert.match(source, /\/T/)
  assert.match(source, /\/F/)
})

test('main keeps the renderer sandboxed with no Node surface', () => {
  const source = read('desktop/main.mjs')
  assert.match(source, /nodeIntegration:\s*false/)
  assert.match(source, /contextIsolation:\s*true/)
  assert.match(source, /sandbox:\s*true/)
  assert.match(source, /setWindowOpenHandler\(\(\) => \(\{ action: 'deny' \}\)\)/)
  assert.match(source, /will-navigate/)
  assert.match(source, /setPermissionRequestHandler/)
  assert.match(source, /preload: join\(desktopDir, 'preload\.cjs'\)/)
})

test('navigation handler uses exact-backend-origin check, not any loopback port', () => {
  const source = read('desktop/main.mjs')
  // The will-navigate handler must call checkNavigationAllowed (which delegates
  // to the exact-origin validator), not the old broad loopback regex.
  assert.match(source, /will-navigate.*\n.*checkNavigationAllowed/s)
  // The old LOOPBACK_ORIGIN_RE constant must not be used for navigation.
  assert.match(source, /LOOPBACK_ORIGIN_RE/)
  // Navigation must not accept any 127.0.0.1:<port> pattern.
  assert.doesNotMatch(
    source,
    /will-navigate.*\n.*LOOPBACK_ORIGIN_RE/s,
  )
})

test('IPC handlers validate sender origin', () => {
  const source = read('desktop/main.mjs')
  // Both privileged IPC handlers must call isTrustedDesktopSender.
  assert.match(source, /isTrustedDesktopSender.*event\.sender\.getURL\(\)/s)
  // The sender URL is checked against the active backend origin, not just
  // accepted unconditionally.
  assert.match(source, /isTrustedDesktopSender\(event\.sender\.getURL\(\),\s*activeBackendOrigin\)/s)
})

test('backend origin is set atomically after ready, not before', () => {
  const source = read('desktop/main.mjs')
  // activeBackendOrigin must be cleared before spawning and set only after
  // backend.ready resolves.
  assert.match(source, /activeBackendOrigin\s*=\s*''/)
  assert.match(source, /activeBackendOrigin\s*=\s*urlOrigin\(backendUrl\)/)
  // The origin assignment must happen inside startBackend, not at module load.
  assert.match(source, /async function startBackend\(/)
  assert.match(source, /activeBackendOrigin = urlOrigin\(backendUrl\)/)
})

test('preload exposes only the narrow Workbench Desktop API', () => {
  const source = read('desktop/preload.cjs')
  assert.match(source, /contextBridge\.exposeInMainWorld\(/)
  assert.match(source, /'mingWorkbench'/)
  assert.match(source, /selectProject/)
  assert.match(source, /quit/)
  assert.doesNotMatch(source, /require\(['"]fs['"]\)/)
  assert.doesNotMatch(source, /require\(['"]child_process['"]\)/)
  assert.doesNotMatch(source, /require\(['"]shell['"]\)/)
  assert.doesNotMatch(source, /exposeInMainWorld\(['"]ipcRenderer['"]/)
  assert.doesNotMatch(source, /exposeInMainWorld\(['"]fs['"]/)
  assert.doesNotMatch(source, /exposeInMainWorld\(['"]child_process['"]/)
})

test('package.json wires the desktop shell without replacing the web slice', () => {
  const pkg = JSON.parse(read('package.json'))
  assert.equal(pkg.main, 'desktop/main.mjs')
  assert.equal(pkg.scripts['desktop:dev'], 'npm run build:test && electron .')
  assert.equal(pkg.scripts['web:local'], 'npm run build:test && node scripts/start-local-web.mjs')
  assert.equal(pkg.build.appId, 'ai.ming.workbench')
  assert.equal(pkg.build.asar, false)
  assert.ok(pkg.build.files.includes('scripts/**/*'))
  assert.ok(pkg.build.files.includes('.tmp/**/*'))
})
