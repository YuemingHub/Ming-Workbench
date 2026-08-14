import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DEFAULT_AAOP_INTAKE_BOUNDARY,
  createIntakeWorkUnit,
  loadWorkbenchProjectManifest,
  parseWorkbenchProjectManifest,
  prepareProjectDevelopmentIntake,
  runProjectAaopBridge,
} from '../.tmp/index.js'

function command(code, timeoutMs = 10_000) {
  return {
    command: process.execPath,
    args: ['-e', code],
    timeoutMs,
  }
}

function manifest(overrides = {}) {
  return {
    schema_version: '1.0',
    project: {
      id: 'fixture-project',
      title: 'Fixture Project',
      domain_pack: 'development-aaop',
    },
    development: {
      aaop_bridge: {
        ready: command("console.log('AAOP READY')"),
        status: command("console.log(JSON.stringify({branch:'feature/test',stage:'development'}))"),
        prompt: command("console.log('Take responsibility for this project from current evidence.')"),
      },
    },
    ...overrides,
  }
}

test('project manifest is a narrow declaration of existing AAOP bridge commands', () => {
  const parsed = parseWorkbenchProjectManifest(manifest())
  assert.equal(parsed.project.domain_pack, 'development-aaop')
  assert.equal(parsed.development.aaop_bridge.ready.command, process.execPath)
  assert.throws(
    () => parseWorkbenchProjectManifest({ ...manifest(), schema_version: '2.0' }),
    /unsupported schema_version/,
  )
})

test('loads workbench.project.json from the selected project root', () => {
  const root = mkdtempSync(join(tmpdir(), 'ming-workbench-project-'))
  try {
    writeFileSync(join(root, 'workbench.project.json'), JSON.stringify(manifest(), null, 2))
    const loaded = loadWorkbenchProjectManifest(root)
    assert.equal(loaded.project.id, 'fixture-project')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('refuses repository-declared commands before the workspace is trusted', () => {
  assert.throws(
    () => runProjectAaopBridge(process.cwd(), manifest(), false),
    /before the workspace is trusted/,
  )
})

test('project bridge strips task secrets while preserving runtime discovery environment', () => {
  const previous = process.env.GITHUB_TOKEN
  process.env.GITHUB_TOKEN = 'must-not-enter-project-bridge'
  try {
    const configured = manifest()
    configured.development.aaop_bridge.ready = command(
      "console.log(JSON.stringify({github:process.env.GITHUB_TOKEN ?? null,path:Boolean(process.env.PATH || process.env.Path)}))",
    )
    const result = runProjectAaopBridge(process.cwd(), configured, true)
    assert.equal(result.ready, true)
    const observed = JSON.parse(result.readyResult.stdout)
    assert.equal(observed.github, null)
    assert.equal(observed.path, true)
  } finally {
    if (previous === undefined) delete process.env.GITHUB_TOKEN
    else process.env.GITHUB_TOKEN = previous
  }
})

test('ordinary language creates an intake Work Unit without fabricated acceptance', () => {
  const now = () => new Date('2026-08-14T03:00:00.000Z')
  const unit = createIntakeWorkUnit(
    '  帮我把这个项目当前最重要的问题处理好。  ',
    'fixture-space',
    now,
    () => 'fixed-id',
  )

  assert.equal(unit.id, 'WU-fixed-id')
  assert.equal(unit.state, 'intake')
  assert.equal(unit.outcome, '帮我把这个项目当前最重要的问题处理好。')
  assert.deepEqual(unit.acceptance, [])
  assert.equal(unit.owner, 'development-aaop')
  assert.match(unit.nextFrontier, /AAOP Developer Intake/)
})

test('successful project bridge automatically prepares a read-only AAOP coordinator message', () => {
  const root = mkdtempSync(join(tmpdir(), 'ming-workbench-project-'))
  try {
    const result = prepareProjectDevelopmentIntake({
      rawRequest: 'Login returns 500. Fix it and verify the regression.',
      projectRoot: root,
      spaceId: 'fixture-space',
      trustedProject: true,
      manifest: manifest(),
      authorizationBoundary: DEFAULT_AAOP_INTAKE_BOUNDARY,
      now: () => new Date('2026-08-14T03:01:00.000Z'),
      idFactory: () => 'intake-id',
    })

    assert.equal(result.status, 'ready-for-aaop-coordinator')
    assert.equal(result.workUnit.id, 'WU-intake-id')
    assert.equal(result.workUnit.state, 'intake')
    assert.equal(result.aaopRequest.rawRequest, 'Login returns 500. Fix it and verify the regression.')
    assert.equal(result.aaopRequest.authorizationBoundary, DEFAULT_AAOP_INTAKE_BOUNDARY)
    assert.match(result.coordinatorMessage, /MING_WORKBENCH_AAOP_DEVELOPER_INTAKE_REQUEST/)
    assert.match(result.coordinatorMessage, /Take responsibility for this project from current evidence/)
    assert.match(result.coordinatorMessage, /authorizes no mutation/)
    assert.match(result.coordinatorMessage, /AAOP remains responsible for Situation, Route/)
    assert.equal('route' in result.aaopRequest, false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('unready project AAOP bridge blocks the Work Unit without auto-running setup', () => {
  const root = mkdtempSync(join(tmpdir(), 'ming-workbench-project-'))
  try {
    const configured = manifest()
    configured.development.aaop_bridge.ready = command(
      "console.error('Run the project AAOP setup explicitly first.'); process.exit(3)",
    )
    const result = prepareProjectDevelopmentIntake({
      rawRequest: 'Continue the most important existing work.',
      projectRoot: root,
      spaceId: 'fixture-space',
      trustedProject: true,
      manifest: configured,
      now: () => new Date('2026-08-14T03:02:00.000Z'),
      idFactory: () => 'blocked-id',
    })

    assert.equal(result.status, 'project-aaop-blocked')
    assert.equal(result.workUnit.state, 'blocked')
    assert.match(result.reason, /setup explicitly first/)
    assert.equal(result.bridge.statusResult, undefined)
    assert.equal(result.bridge.promptResult, undefined)
    assert.match(result.workUnit.nextFrontier, /Repair or deliberately prepare/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
