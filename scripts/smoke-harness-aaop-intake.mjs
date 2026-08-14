import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import {
  prepareProjectDevelopmentIntake,
  runProjectAaopCoordinator,
} from '../.tmp/index.js'

const harnessCheckout = process.env.MING_HARNESS_CHECKOUT
if (!harnessCheckout) {
  throw new Error('MING_HARNESS_CHECKOUT is required for the AAOP Intake smoke')
}

const workbenchRoot = resolve(process.cwd())
const rawRequest = 'Review this repository and identify the most important current development frontier.'

function command(code) {
  return {
    command: process.execPath,
    args: ['-e', code],
    timeoutMs: 10_000,
  }
}

const manifest = {
  schema_version: '1.0',
  project: {
    id: 'ming-workbench-smoke',
    title: 'Ming Workbench Smoke',
    domain_pack: 'development-aaop',
  },
  development: {
    aaop_bridge: {
      ready: command("console.log('AAOP READY')"),
      status: command("console.log(JSON.stringify({project:'Ming-Workbench',stage:'development'}))"),
      prompt: command("console.log('Inspect current repository evidence read-only and derive AAOP canonical Developer Intake.')"),
    },
  },
}

const beforeStatus = execFileSync(
  'git',
  ['-C', workbenchRoot, 'status', '--porcelain', '--untracked-files=all'],
  { encoding: 'utf8' },
).trim()
if (beforeStatus) {
  throw new Error(`AAOP Intake smoke requires a clean baseline: ${beforeStatus}`)
}

const prepared = prepareProjectDevelopmentIntake({
  rawRequest,
  projectRoot: workbenchRoot,
  spaceId: 'ming-workbench-smoke-space',
  trustedProject: true,
  manifest,
  now: () => new Date('2026-08-14T04:30:00.000Z'),
  idFactory: () => 'hosted-intake-smoke',
})

if (prepared.status !== 'ready-for-aaop-coordinator') {
  throw new Error(`Project bridge did not become coordinator-ready: ${prepared.reason}`)
}

const result = await runProjectAaopCoordinator({
  prepared,
  projectRoot: workbenchRoot,
  harnessCheckout: resolve(harnessCheckout),
  workbenchRoot,
  provider: 'deepseek-official',
  model: 'deepseek-v4-pro',
  sessionRoot: resolve(workbenchRoot, '.workbench', 'runtime', 'harness-intake-smoke-sessions'),
  now: () => new Date('2026-08-14T04:31:00.000Z'),
})

if (result.stopReason !== 'end_turn') {
  throw new Error(`AAOP Intake smoke expected end_turn, received ${result.stopReason}`)
}
if (result.envelope.raw_request !== rawRequest) {
  throw new Error('AAOP Intake smoke envelope changed the raw request')
}
if (result.envelope.route !== 'understand-review') {
  throw new Error(`AAOP Intake smoke expected understand-review, received ${result.envelope.route}`)
}
if (result.workUnit.state !== 'ready') {
  throw new Error(`AAOP Intake smoke expected Work Unit ready, received ${result.workUnit.state}`)
}
if (result.workUnit.acceptance.length !== 0) {
  throw new Error('AAOP Intake smoke fabricated acceptance criteria during Intake')
}
const lastEvidence = result.workUnit.evidence.at(-1)
if (!lastEvidence || lastEvidence.kind !== 'session' || lastEvidence.authoritative !== false) {
  throw new Error('AAOP Intake smoke did not record non-authoritative session evidence')
}

const afterStatus = execFileSync(
  'git',
  ['-C', workbenchRoot, 'status', '--porcelain', '--untracked-files=all'],
  { encoding: 'utf8' },
).trim()
if (afterStatus) {
  throw new Error(`Read-only AAOP Intake session mutated repository state: ${afterStatus}`)
}

console.log(JSON.stringify({
  smoke: 'aaop-intake-pass',
  sessionId: result.sessionId,
  route: result.envelope.route,
  routeConfidence: result.envelope.route_confidence,
  workUnitState: result.workUnit.state,
  nonAuthoritativeSessionEvidence: true,
  repositoryRemainedClean: true,
}))
