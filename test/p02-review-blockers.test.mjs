import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { proposeMutationScope } from '../.tmp/execution/scope-proposal.js'

function read(relative) {
  return readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
}

// ===== B1: Auto-updater ESM loading =====
test('B1: main.mjs uses createRequire for ESM-compatible electron-updater loading', () => {
  const source = read('desktop/main.mjs')
  // Must import createRequire from node:module (ESM-compatible)
  assert.match(source, /import\s*\{[^}]*createRequire[^}]*\}\s*from\s*['"]node:module['"]/)
  // Must NOT use bare require('electron-updater')
  assert.doesNotMatch(source, /require\(\s*['"]electron-updater['"]\s*\)/)
  // Must use createRequire to load electron-updater
  assert.match(source, /createRequire.*electron-updater/s)
  // Must verify the autoUpdater API is present
  assert.match(source, /checkForUpdates.*function|typeof au\.checkForUpdates/)
})

test('B1: tryLoadAutoUpdater logs load success or failure', () => {
  const source = read('desktop/main.mjs')
  assert.match(source, /auto-updater loaded/)
  assert.match(source, /auto-updater load failed/)
})

// ===== B2: Renderer is not execution authority =====
test('B2: renderer cannot unlock update during real execution', () => {
  const source = read('desktop/main.mjs')
  // The workUnitRunning boolean must not be the install gate
  assert.doesNotMatch(source, /if\s*\(!updateInfo\s*\|\|\s*workUnitRunning\)/)
  // Must use isExecutionActiveFromStore as the gate
  assert.match(source, /isExecutionActiveFromStore/)
  // The store-based check must look at executing states
  assert.match(source, /EXECUTING_STATES/)
  assert.match(source, /'running'/)
  assert.match(source, /'verifying'/)
  // The renderer IPC handler must NOT set an authoritative boolean
  assert.match(source, /Display hint only.*not authoritative|display hint only/i)
})

test('B2: backend persists running state before execution starts', () => {
  const source = read('src/web/local-server.ts')
  // The /api/execute handler must persist 'running' state before calling runBoundedExecution
  assert.match(source, /runningUnits/)
  assert.match(source, /state:\s*'running'/)
  assert.match(source, /B2.*persist/s)
  assert.match(source, /running.*BEFORE/s)
})

// ===== B3: Real Workbench-derived proposed scope =====
test('B3: scope-proposal module produces non-authoritative proposals from git-tracked files', () => {
  // Create a temp git repo with some files
  const tmpDir = mkdtempSync(join(tmpdir(), 'scope-test-'))
  execFileSync('git', ['-C', tmpDir, 'init'], { stdio: 'ignore' })
  execFileSync('git', ['-C', tmpDir, 'config', 'user.email', 'test@test.invalid'], { stdio: 'ignore' })
  execFileSync('git', ['-C', tmpDir, 'config', 'user.name', 'Test'], { stdio: 'ignore' })
  
  // Create files that match keywords
  mkdirSync(join(tmpDir, 'src'), { recursive: true })
  mkdirSync(join(tmpDir, 'test'), { recursive: true })
  writeFileSync(join(tmpDir, 'src', 'safety-gate.js'), '// safety gate implementation')
  writeFileSync(join(tmpDir, 'test', 'safety-gate.test.mjs'), '// safety gate test')
  writeFileSync(join(tmpDir, 'README.md'), '# project readme')
  
  execFileSync('git', ['-C', tmpDir, 'add', '-A'], { stdio: 'ignore' })
  execFileSync('git', ['-C', tmpDir, 'commit', '-m', 'init'], { stdio: 'ignore' })

  const proposal = proposeMutationScope({
    projectRoot: tmpDir,
    rawRequest: '修改 safety gate 的实现',
    intakeEvidence: ['Found safety-gate.js in src/'],
    nextAction: 'Update safety gate implementation',
    route: 'feature-change',
  })

  assert.equal(proposal.authoritative, false)
  assert.ok(proposal.paths.length > 0, 'should find matching files')
  // Should include the safety-gate files
  const allPaths = proposal.paths.join(' ')
  assert.match(allPaths, /safety-gate/)
})

test('B3: scope-proposal fails closed when no matching files found', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'scope-empty-'))
  execFileSync('git', ['-C', tmpDir, 'init'], { stdio: 'ignore' })
  execFileSync('git', ['-C', tmpDir, 'config', 'user.email', 'test@test.invalid'], { stdio: 'ignore' })
  execFileSync('git', ['-C', tmpDir, 'config', 'user.name', 'Test'], { stdio: 'ignore' })
  
  writeFileSync(join(tmpDir, 'unrelated.js'), '// nothing relevant')
  execFileSync('git', ['-C', tmpDir, 'add', '-A'], { stdio: 'ignore' })
  execFileSync('git', ['-C', tmpDir, 'commit', '-m', 'init'], { stdio: 'ignore' })

  const proposal = proposeMutationScope({
    projectRoot: tmpDir,
    rawRequest: 'qwxzpzx zzzzzzz',
    intakeEvidence: ['qwxzpzx'],
    nextAction: 'qwxzpzx',
    route: 'understand-review',
  })

  assert.equal(proposal.authoritative, false)
  assert.equal(proposal.paths.length, 0, 'should return empty paths when no match: ' + JSON.stringify(proposal))
})

test('B3: local UI does not reference proposedFiles (uses proposedMutation)', () => {
  const source = read('src/web/local-ui.ts')
  // Must not reference the old fake proposedFiles
  assert.doesNotMatch(source, /proposedFiles/)
  // Must reference proposedMutation
  assert.match(source, /proposedMutation/)
})

test('B3: local server includes proposedMutation in intake response', () => {
  const source = read('src/web/local-server.ts')
  assert.match(source, /proposeMutationScope/)
  assert.match(source, /deriveProposedMutation/)
  assert.match(source, /proposedMutation/)
})

// ===== B4: No CLI instructions in packaged UX =====
test('B4: packaged error messages do not contain npm commands', () => {
  const source = read('desktop/main.mjs')
  // The packaged error path must use app.isPackaged to branch
  assert.match(source, /app\.isPackaged/)
  // Find all error message strings — the npm command references must be
  // inside the dev-mode (non-packaged) branch only.
  // Extract the packaged-mode error strings and verify they don't contain npm/node
  const packagedHarnessError = source.match(/app\.isPackaged\?\s*\n?\s*'([^']*(?:\\n[^']*)*)'/g)
  if (packagedHarnessError) {
    for (const match of packagedHarnessError) {
      assert.doesNotMatch(match, /npm\s+run/, `packaged error contains npm: ${match}`)
      assert.doesNotMatch(match, /node\s+/, `packaged error contains node: ${match}`)
    }
  }
  // Verify the dev-mode branch CAN contain dev commands
  assert.match(source, /npm run harness:prepare/)
  assert.match(source, /npm run build:test/)
})

test('B4: packaged error copy is human-facing, not technical', () => {
  const source = read('desktop/main.mjs')
  // Packaged messages should mention network or restart, not terminal commands
  assert.match(source, /检查网络连接后重新启动/)
  assert.match(source, /如果问题持续.*Git/)
})
