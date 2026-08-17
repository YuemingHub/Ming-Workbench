import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { resolveGitPrerequisiteStatus } from '../.tmp/projects/git-prerequisite.js'

function createRepository() {
  const cwd = mkdtempSync(join(tmpdir(), 'ming-workbench-git-pre-'))
  execFileSync('git', ['init', '-q', cwd])
  execFileSync('git', ['-C', cwd, 'config', 'user.email', 'pre@local.test'])
  execFileSync('git', ['-C', cwd, 'config', 'user.name', 'Pre'])
  writeFileSync(join(cwd, 'README.md'), 'fixture\n')
  execFileSync('git', ['-C', cwd, 'add', 'README.md'])
  execFileSync('git', ['-C', cwd, 'commit', '-q', '-m', 'init'])
  return cwd
}

function createPlainDir() {
  return mkdtempSync(join(tmpdir(), 'ming-workbench-plain-'))
}

test('git prerequisite reports ready for a real repository', () => {
  const repo = createRepository()
  try {
    const status = resolveGitPrerequisiteStatus(repo)
    assert.equal(status.gitAvailable, true)
    assert.equal(status.projectIsRepository, true)
    assert.ok(status.gitVersion)
    assert.match(status.message, /就绪/)
  } finally {
    rmSync(repo, { recursive: true, force: true })
  }
})

test('git prerequisite reports a plain directory as not a repository', () => {
  const dir = createPlainDir()
  try {
    const status = resolveGitPrerequisiteStatus(dir)
    assert.equal(status.gitAvailable, true)
    assert.equal(status.projectIsRepository, false)
    assert.match(status.message, /Git 仓库/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('git prerequisite reports missing git executable honestly', () => {
  const dir = createPlainDir()
  try {
    const status = resolveGitPrerequisiteStatus(dir, {
      gitCommand: () => ({ status: 127, stdout: '' }),
      projectIsRepository: () => false,
    })
    assert.equal(status.gitAvailable, false)
    assert.equal(status.projectIsRepository, false)
    assert.match(status.message, /安装 Git/)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('git prerequisite never runs git when git is already absent', () => {
  let gitCalls = 0
  const status = resolveGitPrerequisiteStatus('/does/not/exist', {
    gitCommand: () => {
      gitCalls += 1
      return { status: 127, stdout: '' }
    },
    projectIsRepository: () => {
      throw new Error('must not be called when git is absent')
    },
  })
  assert.equal(status.gitAvailable, false)
  assert.equal(status.projectIsRepository, false)
  assert.equal(gitCalls, 1)
})
