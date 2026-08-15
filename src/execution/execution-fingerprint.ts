import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import type { ProviderExecutionGrant } from './provider-grant.js'
import { inspectHarnessCheckout } from '../transports/harness-acp.js'
import { HARNESS_REVIEWED_VERSION } from '../hosts/harness.js'

/**
 * P1-2: ExecutionFingerprint — the reconstructable identity of the runtime that
 * produced a Run.
 *
 * It deliberately does NOT copy large configuration. It records identity +
 * digest + pointer: harness version/commit, the composition profile id + digest,
 * provider/model, the permission preset and sandbox mode, the workspace
 * repository/baseRef, and a digest of the relevant Workbench-side configuration.
 *
 * Goal: months later, still be able to answer "what execution environment
 * produced this result?" by comparing a recorded fingerprint to a candidate
 * environment — without needing to replay the original session.
 */

export type HarnessPermissionPreset = 'read-only' | 'write-authorized'

export interface ExecutionFingerprint {
  harness: {
    version: string
    commit: string
  }
  profile: {
    id: string
    digest: string
  }
  provider: string
  model?: string
  permissionPreset: HarnessPermissionPreset
  sandboxMode: 'read-only' | 'workspace-write'
  workspace: {
    repository: string
    baseRef: string
  }
  workbenchConfigDigest: string
}

export interface ExecutionFingerprintInput {
  /** Absolute Ming Workbench checkout containing harness/acp/ workbench profiles. */
  workbenchRoot: string
  /** Absolute reviewed DeepSeek Harness source checkout. */
  harnessCheckout: string
  provider?: string
  model?: string
  grant: ProviderExecutionGrant
  /** Explicit profile id override (defaults to the write-execution profile). */
  profileId?: string
}

export const WORKBENCH_WRITE_PROFILE_ID = 'workbench.cordis.yml'

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function profilePathFor(workbenchRoot: string, profileId: string): string {
  return resolve(join(workbenchRoot, 'harness', 'acp', profileId))
}

function fileDigestOrEmpty(filePath: string): string {
  try {
    return sha256(readFileSync(filePath, 'utf8'))
  } catch {
    return ''
  }
}

/**
 * Build the reconstructable runtime identity for one run. The profile file and
 * harness checkout are read live so a drift (unreviewed harness, changed profile)
 * is recorded rather than assumed.
 */
export function buildExecutionFingerprint(
  input: ExecutionFingerprintInput,
): ExecutionFingerprint {
  const profileId = input.profileId ?? WORKBENCH_WRITE_PROFILE_ID
  const profilePath = profilePathFor(input.workbenchRoot, profileId)
  const profileDigest = fileDigestOrEmpty(profilePath)

  // Relevant Workbench-side configuration digest: the profile that shapes the
  // run plus the lockfile pinning the reviewed harness revision.
  const lockPath = resolve(join(input.workbenchRoot, 'harness.lock.json'))
  const configDigest = sha256(`${profileDigest}|${fileDigestOrEmpty(lockPath)}`)

  const checkedInHarness = inspectHarnessCheckout(input.harnessCheckout)
  const writeTarget = input.grant.authorization.write_target

  return {
    harness: {
      version: HARNESS_REVIEWED_VERSION,
      commit: checkedInHarness.commit || HARNESS_REVIEWED_VERSION,
    },
    profile: {
      id: profileId,
      digest: profileDigest,
    },
    provider: input.provider ?? input.grant.provider,
    model: input.model,
    permissionPreset: input.grant.authorization.mutation_boundary,
    sandboxMode:
      input.grant.authorization.mutation_boundary === 'read-only'
        ? 'read-only'
        : 'workspace-write',
    workspace: {
      repository: writeTarget?.repository ?? '',
      baseRef: writeTarget?.base_ref ?? '',
    },
    workbenchConfigDigest: configDigest,
  }
}

export function sameExecutionFingerprint(
  left: ExecutionFingerprint,
  right: ExecutionFingerprint,
): boolean {
  return (
    left.harness.commit === right.harness.commit
    && left.harness.version === right.harness.version
    && left.profile.id === right.profile.id
    && left.profile.digest === right.profile.digest
    && left.provider === right.provider
    && (left.model ?? '') === (right.model ?? '')
    && left.permissionPreset === right.permissionPreset
    && left.sandboxMode === right.sandboxMode
    && left.workspace.repository === right.workspace.repository
    && left.workspace.baseRef === right.workspace.baseRef
    && left.workbenchConfigDigest === right.workbenchConfigDigest
  )
}
