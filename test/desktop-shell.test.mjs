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
