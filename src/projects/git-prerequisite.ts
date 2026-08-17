/**
 * Product-level Git prerequisite detection.
 *
 * Ming Workbench v0.1 keeps System Git as its single documented external
 * prerequisite: every execution path (intake grounding, mutation scope,
 * bounded execution, evidence verification) operates on a real Git repository
 * through the `git` executable. Unlike the Harness runtime and Python, Git
 * cannot yet be bundled; it must be a clearly detectable, explainable
 * prerequisite rather than an accidental developer dependency.
 *
 * This module gives the product one honest answer about Git availability:
 *   - is Git executable present?
 *   - is the selected directory a Git working tree?
 * Neither check mutates anything.
 */

import { spawnSync } from 'node:child_process'
import { statSync } from 'node:fs'
import { resolve } from 'node:path'

export interface GitPrerequisiteStatus {
  gitAvailable: boolean
  gitVersion?: string
  projectIsRepository: boolean
  /** human-readable, product-owned explanation (never a terminal command). */
  message: string
}

export interface GitPrerequisiteDependencies {
  gitCommand?: (args: string[]) => { status: number | null; stdout: string }
  projectIsRepository?: (projectRoot: string) => boolean
}

function runGit(
  args: string[],
): { status: number | null; stdout: string } {
  const result = spawnSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    timeout: 10_000,
  })
  return { status: result.status, stdout: result.stdout ?? '' }
}

function detectProjectRepository(projectRoot: string): boolean {
  try {
    if (!statSync(projectRoot).isDirectory()) return false
  } catch {
    return false
  }
  const probe = runGit(['-C', resolve(projectRoot), 'rev-parse', '--is-inside-work-tree'])
  return probe.status === 0 && probe.stdout.trim() === 'true'
}

export function resolveGitPrerequisiteStatus(
  projectRoot: string,
  dependencies: GitPrerequisiteDependencies = {},
): GitPrerequisiteStatus {
  const gitCommand = dependencies.gitCommand ?? runGit
  const projectIsRepository = dependencies.projectIsRepository ?? detectProjectRepository

  const versionProbe = gitCommand(['--version'])
  const gitAvailable = versionProbe.status === 0
  const gitVersion = gitAvailable ? versionProbe.stdout.trim() : undefined

  const projectIsRepositoryValue = gitAvailable
    ? projectIsRepository(projectRoot)
    : false

  let message: string
  if (!gitAvailable) {
    message = 'Ming Workbench 需要 Git 才能处理项目。请先安装 Git（git-scm.com），然后重新选择项目。'
  } else if (!projectIsRepositoryValue) {
    message = '这个文件夹还不是一个 Git 仓库。Ming Workbench 目前需要在一个 Git 项目上工作。请选择一个 Git 项目，或先在该文件夹中初始化 Git。'
  } else {
    message = 'Git 就绪，项目是有效的 Git 仓库。'
  }

  return {
    gitAvailable,
    gitVersion,
    projectIsRepository: projectIsRepositoryValue,
    message,
  }
}
