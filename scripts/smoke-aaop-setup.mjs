import { execFileSync } from 'node:child_process'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  enableProjectAaop,
  resolveProjectOnboarding,
  runProjectAaopBridge,
} from '../.tmp/index.js'

const projectRoot = mkdtempSync(join(tmpdir(), 'ming-workbench-aaop-setup-smoke-'))

try {
  execFileSync('git', ['init', '--quiet', projectRoot])
  writeFileSync(
    join(projectRoot, 'README.md'),
    '# Workbench AAOP setup smoke\n\nEphemeral project for exact stable setup validation.\n',
    'utf8',
  )

  const before = resolveProjectOnboarding(projectRoot)
  if (before.status !== 'setup-required') {
    throw new Error(`Expected plain project to require setup, received ${before.status}`)
  }

  const installed = await enableProjectAaop({
    projectRoot,
    authorized: true,
  })
  if (installed.status !== 'installed') {
    throw new Error(`AAOP setup smoke failed: ${installed.reason ?? installed.status}`)
  }

  if (!/^[0-9a-f]{40}$/.test(installed.sourceRevision)) {
    throw new Error(`AAOP setup did not preserve an exact source revision: ${installed.sourceRevision}`)
  }
  if (!installed.aaopVersion) {
    throw new Error('AAOP setup did not return a release identity')
  }

  const installedVersion = readFileSync(join(projectRoot, '.aaop', 'VERSION'), 'utf8').trim()
  if (installedVersion !== installed.aaopVersion) {
    throw new Error(
      `Installed VERSION mismatch: expected ${installed.aaopVersion}, received ${installedVersion}`,
    )
  }

  const after = resolveProjectOnboarding(projectRoot)
  if (after.status !== 'ready') {
    throw new Error(`Installed project did not become onboarding-ready: ${after.status}`)
  }
  if (after.source !== 'installed-aaop') {
    throw new Error(`Expected manifest-owned AAOP after setup, received ${after.source}`)
  }
  if (after.aaopVersion !== installed.aaopVersion) {
    throw new Error(
      `Onboarding release mismatch after setup: ${after.aaopVersion} != ${installed.aaopVersion}`,
    )
  }

  const bridge = runProjectAaopBridge(projectRoot, after.manifest, true)
  if (!bridge.ready) {
    throw new Error(`Canonical AAOP bridge was not ready after setup: ${bridge.reason}`)
  }

  console.log(JSON.stringify({
    smoke: 'aaop-setup-pass',
    sourceRevision: installed.sourceRevision,
    aaopVersion: installed.aaopVersion,
    onboardingSource: after.source,
    canonicalBridgeReady: bridge.ready,
    workbenchManifestCreated: false,
  }))
} finally {
  rmSync(projectRoot, { recursive: true, force: true })
}
