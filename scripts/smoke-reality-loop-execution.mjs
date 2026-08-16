#!/usr/bin/env node
/**
 * Real Reality-Loop execution smoke (local, mock provider).
 *
 * Proves the EXECUTE half of the L3 chain with the REAL reviewed-Harness ACP
 * transport (not a harness double): a scratch git repo with README
 * "Version: OLD" receives a plain grant to change it to "Version: NEW", the
 * real Harness agent calls its real `write` tool (driven by the repository-
 * owned mock provider), the delta is verified inside the isolation, applied
 * back to the real repo, and the real git diff is observed independently.
 *
 * This is a transport/product-execution smoke. It is NOT the L3 human-UI
 * journey; it proves the mutation + verification machinery with real ACP.
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { readRepositorySnapshot } from '../.tmp/execution/repository.js'
import { issueProviderExecutionGrant } from '../.tmp/execution/grant-issuance.js'
import { runBoundedExecution } from '../.tmp/execution/bounded-execution.js'
import { buildExactSlice } from '../.tmp/execution/mutation-slice.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const harnessCheckout = process.env.MING_HARNESS_CHECKOUT
if (!harnessCheckout) {
  console.error('MING_HARNESS_CHECKOUT is required (point at the capsule or prepared checkout)')
  process.exit(1)
}
if (!process.env.DEEPSEEK_API_KEY || !process.env.DEEPSEEK_BASE_URL) {
  console.error('DEEPSEEK_API_KEY + DEEPSEEK_BASE_URL are required (mock provider fixture)')
  process.exit(1)
}

// The provider fixture observes a FIXED scratch path so it can decide read vs
// write based on real README state across retries. Create the scratch repo
// there so the fixture and the execution share the same reality.
const FIXTURE_TARGET = process.env.FIXTURE_TARGET_DIR
if (!FIXTURE_TARGET) {
  console.error('FIXTURE_TARGET_DIR is required (absolute scratch project path the fixture observes)')
  process.exit(1)
}
const projectRoot = FIXTURE_TARGET
rmSync(projectRoot, { recursive: true, force: true })
mkdirSync(projectRoot, { recursive: true })
let harnessCheckoutResolved = resolve(harnessCheckout)

try {
  execFileSync('git', ['-C', projectRoot, 'init', '-q'])
  execFileSync('git', ['-C', projectRoot, 'config', 'user.email', 'reality@local.test'])
  execFileSync('git', ['-C', projectRoot, 'config', 'user.name', 'Reality'])
  writeFileSync(join(projectRoot, 'README.md'), '# Workbench Reality Test\n\nVersion: OLD\n')
  execFileSync('git', ['-C', projectRoot, 'add', '.'])
  execFileSync('git', ['-C', projectRoot, 'commit', '-qm', 'init: OLD'])

  const before = readFileSync(join(projectRoot, 'README.md'), 'utf8')
  if (!before.includes('Version: OLD')) throw new Error('scratch README does not start as OLD')

  const workUnit = {
    id: 'WU-REALITY-LOOP',
    spaceId: 'SPACE-reality',
    title: 'Change README Version from OLD to NEW',
    outcome: 'README contains Version: NEW',
    state: 'ready',
    owner: 'development-aaop',
    gate: { kind: 'none', open: false },
    acceptance: [],
    evidence: [],
    assets: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }

  const snapshot = readRepositorySnapshot(projectRoot)
  const slice = buildExactSlice(projectRoot, snapshot.head, ['README.md'])
  const { grant, binding } = issueProviderExecutionGrant({ workUnit, projectRoot, snapshot, slice })

  const result = await runBoundedExecution({
    workUnit,
    grant,
    binding,
    slice,
    projectRoot,
    harnessCheckout: harnessCheckoutResolved,
    workbenchRoot: root,
    provider: 'deepseek-official',
    model: 'deepseek-v4-pro',
    sessionRoot: join(root, '.workbench', 'runtime', 'reality-loop-sessions'),
    // No test command: this is a doc-content change; repository readback is the
    // independent evidence.
    allowWrite: true,
  })

  // Independent observation, not Harness chatter.
  const after = readFileSync(join(projectRoot, 'README.md'), 'utf8')
  const diff = execFileSync('git', ['-C', projectRoot, 'diff'], { encoding: 'utf8' })
  const status = execFileSync('git', ['-C', projectRoot, 'status', '--porcelain'], { encoding: 'utf8' }).trim()

  console.log('runOutcome:', JSON.stringify(result.runOutcome))
  console.log('workUnit.state:', result.workUnit.state)
  console.log('git status:', JSON.stringify(status))
  console.log('git diff:\n' + diff)
  console.log('README after:\n' + after)

  if (!after.includes('Version: NEW')) throw new Error('README did not reach Version: NEW')
  if (!result.repositoryReadback.executionProducedChanges.includes('README.md')) {
    throw new Error('execution did not produce the README change')
  }
  if (result.repositoryReadback.scopeViolations.length !== 0) {
    throw new Error(`scope violations: ${result.repositoryReadback.scopeViolations.join(', ')}`)
  }
  if (result.runOutcome.verification !== 'passed') {
    throw new Error(`verification not passed: ${result.runOutcome.verification}`)
  }
  if (result.runOutcome.acceptance !== 'pending') {
    throw new Error(`acceptance should be human-owned pending, got ${result.runOutcome.acceptance}`)
  }
  if (!result.workUnit.evidence.some((e) => e.kind === 'repository')) {
    throw new Error('no repository evidence recorded')
  }

  console.log(JSON.stringify({
    smoke: 'reality-loop-execution-pass',
    before: 'Version: OLD',
    afterObserved: 'Version: NEW',
    workUnitState: result.workUnit.state,
    verification: result.runOutcome.verification,
    evidenceCount: result.workUnit.evidence.length,
  }))
} finally {
  // The fixture target is deliberately left in place (the provider observes it
  // across retries); the smoke does not clean it up.
}
