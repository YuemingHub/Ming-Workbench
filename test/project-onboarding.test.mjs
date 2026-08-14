import test from 'node:test'
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import { resolveProjectOnboarding } from '../.tmp/index.js'

function tempProject() {
  return mkdtempSync(join(tmpdir(), 'ming-workbench-onboarding-'))
}

function cleanup(root) {
  rmSync(root, { recursive: true, force: true })
}

function write(root, relative, content = '') {
  const path = join(root, relative)
  mkdirSync(join(path, '..'), { recursive: true })
  writeFileSync(path, content, 'utf8')
}

function snapshot(root) {
  const result = []
  function walk(current, prefix = '') {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name
      const absolute = join(current, entry.name)
      if (entry.isDirectory()) {
        result.push(`dir:${relative}`)
        walk(absolute, relative)
      } else if (entry.isFile()) {
        result.push(`file:${relative}:${readFileSync(absolute, 'utf8')}`)
      }
    }
  }
  walk(root)
  return result.sort()
}

function explicitManifest() {
  return {
    schema_version: '1.0',
    project: {
      id: 'explicit-project',
      title: 'Explicit Project',
      domain_pack: 'development-aaop',
    },
    development: {
      aaop_bridge: {
        ready: { command: 'node', args: ['ready'] },
        status: { command: 'node', args: ['status'] },
        prompt: { command: 'node', args: ['prompt'] },
      },
    },
  }
}

function writeRecognizableAaop(root, { manifest = true, version = '1.2.0', manifestVersion = version } = {}) {
  write(root, '.aaop/ORCHESTRATOR.md', '# AAOP Runtime Protocol\nStatus: test fixture\n')
  write(root, '.aaop/VERSION', `${version}\n`)
  write(root, '.aaop/tools/aaop.py', '# fixture tool\n')
  if (manifest) {
    write(root, '.aaop/.install-manifest.json', `${JSON.stringify({
      schema_version: 2,
      aaop_version: manifestVersion,
      managed_by: 'AAOP installer',
      files: {
        'ORCHESTRATOR.md': 'fixture',
        'VERSION': 'fixture',
        'tools/aaop.py': 'fixture',
      },
      bootstrap_blocks: {},
    }, null, 2)}\n`)
  }
}

const linuxPython = {
  platform: 'linux',
  env: {},
  commandAvailable: (command) => command === 'python3',
}

test('explicit Workbench manifest has precedence over incidental .aaop content', () => {
  const root = tempProject()
  try {
    write(root, 'workbench.project.json', `${JSON.stringify(explicitManifest(), null, 2)}\n`)
    write(root, '.aaop/ORCHESTRATOR.md', 'not an AAOP installation')

    const result = resolveProjectOnboarding(root, {
      ...linuxPython,
      commandAvailable: () => {
        throw new Error('Python discovery must not run for an explicit manifest')
      },
    })

    assert.equal(result.status, 'ready')
    assert.equal(result.source, 'workbench-manifest')
    assert.equal(result.project.id, 'explicit-project')
    assert.equal(result.project.title, 'Explicit Project')
    assert.equal(result.manifest.project.id, 'explicit-project')
  } finally {
    cleanup(root)
  }
})

test('recognizable installed AAOP derives the canonical bridge in memory without creating project config', () => {
  const root = tempProject()
  try {
    writeRecognizableAaop(root)
    const before = snapshot(root)

    const result = resolveProjectOnboarding(root, linuxPython)

    assert.equal(result.status, 'ready')
    assert.equal(result.source, 'installed-aaop')
    assert.equal(result.aaopVersion, '1.2.0')
    assert.equal(result.pythonCommand, 'python3')
    assert.equal(result.project.title, basename(root))
    assert.match(result.project.id, /^local-/)
    assert.deepEqual(result.manifest.development.aaop_bridge.ready, {
      command: 'python3',
      args: ['.aaop/tools/aaop.py', 'ready', '.'],
      timeoutMs: 60_000,
    })
    assert.deepEqual(result.manifest.development.aaop_bridge.status, {
      command: 'python3',
      args: ['.aaop/tools/aaop.py', 'status', '.'],
      timeoutMs: 60_000,
    })
    assert.deepEqual(result.manifest.development.aaop_bridge.prompt, {
      command: 'python3',
      args: ['.aaop/tools/aaop.py', 'prompt'],
      timeoutMs: 60_000,
    })
    assert.equal(existsSync(join(root, 'workbench.project.json')), false)
    assert.deepEqual(snapshot(root), before)
  } finally {
    cleanup(root)
  }
})

test('recognizable legacy AAOP without installer manifest remains usable but does not weaken identity checks', () => {
  const root = tempProject()
  try {
    writeRecognizableAaop(root, { manifest: false })
    const result = resolveProjectOnboarding(root, linuxPython)

    assert.equal(result.status, 'ready')
    assert.equal(result.source, 'legacy-aaop')
    assert.equal(result.aaopVersion, '1.2.0')
  } finally {
    cleanup(root)
  }
})

test('bare generic .aaop directory is not mistaken for an installed control plane', () => {
  const root = tempProject()
  try {
    write(root, '.aaop/ORCHESTRATOR.md', '# My unrelated project config\n')
    write(root, '.aaop/VERSION', '1.2.0\n')
    write(root, '.aaop/tools/aaop.py', '# unrelated tool\n')

    const result = resolveProjectOnboarding(root, linuxPython)

    assert.equal(result.status, 'blocked')
    assert.match(result.reason, /cannot prove a usable AAOP installation/)
    assert.match(result.reason, /will not overwrite or repair it automatically/)
  } finally {
    cleanup(root)
  }
})

test('AAOP installer manifest and VERSION disagreement fails closed', () => {
  const root = tempProject()
  try {
    writeRecognizableAaop(root, { version: '1.2.0', manifestVersion: '1.1.0' })
    const result = resolveProjectOnboarding(root, linuxPython)

    assert.equal(result.status, 'blocked')
    assert.match(result.reason, /does not match its ownership manifest/)
  } finally {
    cleanup(root)
  }
})

test('installed AAOP without a usable Python command becomes an environment blocker, not a reinstall', () => {
  const root = tempProject()
  try {
    writeRecognizableAaop(root)
    const result = resolveProjectOnboarding(root, {
      platform: 'linux',
      env: {},
      commandAvailable: () => false,
    })

    assert.equal(result.status, 'blocked')
    assert.match(result.reason, /cannot find a usable Python command/)
  } finally {
    cleanup(root)
  }
})

test('plain project returns one setup-required result without exposing manual manifest plumbing', () => {
  const root = tempProject()
  try {
    write(root, 'README.md', '# Ordinary project\n')
    let commandChecks = 0
    const before = snapshot(root)
    const result = resolveProjectOnboarding(root, {
      platform: 'linux',
      env: {},
      commandAvailable: () => {
        commandChecks += 1
        return true
      },
    })

    assert.equal(result.status, 'setup-required')
    assert.equal(result.project.title, basename(root))
    assert.equal(result.reason.includes('workbench.project.json'), false)
    assert.equal(commandChecks, 0)
    assert.deepEqual(snapshot(root), before)
  } finally {
    cleanup(root)
  }
})
