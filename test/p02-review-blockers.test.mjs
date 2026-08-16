import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { proposeMutationScope } from '../.tmp/execution/scope-proposal.js'

function read(relative) {
  return readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8')
}

function makeGitRepo(files) {
  const dir = mkdtempSync(join(tmpdir(), 'p03-scope-'))
  execFileSync('git', ['-C', dir, 'init'], { stdio: 'ignore' })
  execFileSync('git', ['-C', dir, 'config', 'user.email', 'test@test.invalid'], { stdio: 'ignore' })
  execFileSync('git', ['-C', dir, 'config', 'user.name', 'Test'], { stdio: 'ignore' })
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content ?? '')
  }
  execFileSync('git', ['-C', dir, 'add', '-A'], { stdio: 'ignore' })
  execFileSync('git', ['-C', dir, 'commit', '-m', 'init'], { stdio: 'ignore' })
  return dir
}

// ===== B1: Auto-updater ESM loading =====
test('B1: main.mjs uses createRequire for ESM-compatible electron-updater loading', () => {
  const source = read('desktop/main.mjs')
  assert.match(source, /import\s*\{[^}]*createRequire[^}]*\}\s*from\s*['"]node:module['"]/)
  assert.doesNotMatch(source, /require\(\s*['"]electron-updater['"]\s*\)/)
  assert.match(source, /createRequire.*electron-updater/s)
  assert.match(source, /checkForUpdates.*function|typeof au\.checkForUpdates/)
})

test('B1: tryLoadAutoUpdater logs load success or failure', () => {
  const source = read('desktop/main.mjs')
  assert.match(source, /auto-updater loaded/)
  assert.match(source, /auto-updater load failed/)
})

// ===== B2: Renderer is not execution authority =====
test('B2: renderer has no execution-authority IPC surface', () => {
  const mainSource = read('desktop/main.mjs')
  const preloadSource = read('desktop/preload.cjs')
  const uiSource = read('src/web/local-ui.ts')
  // The renderer execution-authority boolean must be gone entirely.
  assert.doesNotMatch(mainSource, /desktop:work-unit-running/)
  assert.doesNotMatch(mainSource, /workUnitRunning/)
  assert.doesNotMatch(preloadSource, /setWorkUnitRunning/)
  assert.doesNotMatch(preloadSource, /work-unit-running/)
  assert.doesNotMatch(uiSource, /setWorkUnitRunning/)
  // The install gate must be the authoritative backend store.
  assert.match(mainSource, /isExecutionActiveFromStore/)
  assert.match(mainSource, /EXECUTING_STATES/)
  assert.match(mainSource, /'running'/)
  assert.match(mainSource, /'verifying'/)
})

test('B2: backend persists running before execution and restores non-running on throw', () => {
  const source = read('src/web/local-server.ts')
  // Running state persisted BEFORE runBoundedExecution.
  assert.match(source, /runningUnits/)
  assert.match(source, /state:\s*'running'/)
  // The catch path must restore a non-running state (blocked) after a throw.
  assert.match(source, /state:\s*'blocked'/)
  assert.match(source, /执行未完成/)
})

// ===== B3: Grounded scope proposal (evidence path extraction) =====
test('B3: scope proposal derives only explicit paths from AAOP evidence, not keyword scanning', () => {
  const dir = makeGitRepo({
    'src/services/safety-gate.js': '// safety logic',
    'test/safety-gate.test.mjs': '// safety test',
    'src/web/local-ui.ts': '// ui',
    'README.md': '# 安全 说明',
  })

  const proposal = proposeMutationScope({
    projectRoot: dir,
    rawRequest: '修复孩子只是把自己关在屋里就被升级成危机的问题。',
    intakeEvidence: [
      'src/services/safety-gate.js — 当前安全等级判断逻辑',
      'test/safety-gate.test.mjs — 对应安全回归',
    ],
    nextAction: '调整安全等级判断',
    route: 'bug-fix',
  })

  assert.equal(proposal.authoritative, false)
  const paths = proposal.items.map((item) => item.path).sort()
  assert.deepEqual(paths, ['src/services/safety-gate.js', 'test/safety-gate.test.mjs'])
  // README.md contains the word 安全 but must NOT be included (no keyword scan).
  assert.ok(!paths.includes('README.md'), 'README must not be included via keyword scan')
})

test('B3: scope proposal extracts an exact user-typed path', () => {
  const dir = makeGitRepo({
    'src/web/local-ui.ts': '// ui',
    'README.md': '# readme',
  })

  const proposal = proposeMutationScope({
    projectRoot: dir,
    rawRequest: '修改 src/web/local-ui.ts 让它更容易理解',
    intakeEvidence: [],
    nextAction: '',
    route: 'feature-change',
  })

  assert.equal(proposal.authoritative, false)
  assert.deepEqual(proposal.items.map((i) => i.path), ['src/web/local-ui.ts'])
})

test('B3: scope proposal fails closed when no explicit path is grounded', () => {
  const dir = makeGitRepo({
    'src/services/safety-gate.js': '// safety',
    'README.md': '# readme',
  })

  const proposal = proposeMutationScope({
    projectRoot: dir,
    rawRequest: '把首页表达改得更容易理解',
    intakeEvidence: ['当前首页主界面与用户输入入口'], // no path
    nextAction: '继续理解项目', // no path
    route: 'feature-change',
  })

  assert.equal(proposal.authoritative, false)
  assert.deepEqual(proposal.items, [])
  assert.equal(proposal.source, 'no-explicit-paths')
})

test('B3: scope proposal rejects traversal, absolute, and protected paths', () => {
  const dir = makeGitRepo({
    'src/ok.js': '// ok',
  })

  const proposal = proposeMutationScope({
    projectRoot: dir,
    rawRequest: '改 ../outside.js 和 /etc/passwd 和 node_modules/x.js 和 src/ok.js',
    intakeEvidence: [],
    nextAction: '',
    route: 'feature-change',
  })

  const paths = proposal.items.map((i) => i.path)
  assert.deepEqual(paths, ['src/ok.js'])
})

test('B3: local UI does not reference proposedFiles and renders paths as text', () => {
  const source = read('src/web/local-ui.ts')
  assert.doesNotMatch(source, /proposedFiles/)
  assert.match(source, /proposedMutation/)
  // Safe rendering: paths must use createElement + textContent, never innerHTML
  // with path concatenation.
  assert.doesNotMatch(source, /innerHTML\s*=.*\.map\(\(p\)\s*=>\s*'<li>'/)
  assert.match(source, /createElement\('li'\)/)
  assert.match(source, /li\.textContent\s*=\s*item\.path/)
})

test('B3: normal UI has no whole-repository option', () => {
  const source = read('src/web/local-ui.ts')
  assert.doesNotMatch(source, /execute-whole/)
  assert.doesNotMatch(source, /wholeRepository:\s*true/)
  assert.doesNotMatch(source, /wholeRepo/)
})

// ===== B4: No CLI instructions in packaged UX =====
test('B4: packaged error messages do not contain npm commands', () => {
  const source = read('desktop/main.mjs')
  assert.match(source, /app\.isPackaged/)
  const packagedHarnessError = source.match(/app\.isPackaged\?\s*\n?\s*'([^']*(?:\\n[^']*)*)'/g)
  if (packagedHarnessError) {
    for (const match of packagedHarnessError) {
      assert.doesNotMatch(match, /npm\s+run/, `packaged error contains npm: ${match}`)
      assert.doesNotMatch(match, /node\s+/, `packaged error contains node: ${match}`)
    }
  }
  assert.match(source, /npm run harness:prepare/)
  assert.match(source, /npm run build:test/)
})

test('B4: packaged error copy is human-facing, not technical', () => {
  const source = read('desktop/main.mjs')
  // The packaged runtime no longer requires the consumer to run npm/node or
  // install Git to prepare the Harness; error copy must stay human-facing and
  // never instruct terminal commands.
  const firstPackagedError = source.match(/'Ming Workbench 需要准备运行环境[^']*'/)[0]
  assert.ok(firstPackagedError.includes('需要准备运行环境，但未能完成'))
  assert.doesNotMatch(firstPackagedError, /npm\s+run|node\s+--?/)
  assert.doesNotMatch(firstPackagedError, /需要安装 Git/)
  const secondPackagedError = source.match(/'Ming Workbench 后端没有准备好[^']*'/)[0]
  assert.ok(secondPackagedError.includes('后端没有准备好'))
  assert.doesNotMatch(secondPackagedError, /npm\s+run|node\s+--?/)
  assert.doesNotMatch(secondPackagedError, /需要安装 Git/)
})
