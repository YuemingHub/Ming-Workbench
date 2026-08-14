export const HARNESS_REVIEWED_VERSION = '0.1.0-rc.5' as const
export const HARNESS_REVIEWED_COMMIT =
  '47f943859bef60e4160492346772ded9b24f765a' as const
export const HARNESS_REVIEW_DATE = '2026-08-14' as const

export type HarnessCapability =
  | 'models'
  | 'tools'
  | 'mcp'
  | 'skills'
  | 'sessions'
  | 'session-query'
  | 'agent-presets'
  | 'subagents'
  | 'workflows'
  | 'jobs'
  | 'approvals'
  | 'permissions'
  | 'web-ui-slots'

export const harnessCapabilities: readonly HarnessCapability[] = [
  'models',
  'tools',
  'mcp',
  'skills',
  'sessions',
  'session-query',
  'agent-presets',
  'subagents',
  'workflows',
  'jobs',
  'approvals',
  'permissions',
  'web-ui-slots',
]

export interface HarnessCompatibilityReport {
  expectedVersion: string
  detectedVersion?: string
  compatible: boolean
  reason: string
}

/**
 * Keep upstream-specific compatibility decisions here rather than leaking
 * DeepSeek Harness internals into Workbench domain logic.
 */
export function assessHarnessVersion(
  detectedVersion: string | undefined,
): HarnessCompatibilityReport {
  if (!detectedVersion) {
    return {
      expectedVersion: HARNESS_REVIEWED_VERSION,
      compatible: false,
      reason: 'DeepSeek Harness package was not detected.',
    }
  }

  if (detectedVersion !== HARNESS_REVIEWED_VERSION) {
    return {
      expectedVersion: HARNESS_REVIEWED_VERSION,
      detectedVersion,
      compatible: false,
      reason:
        'Harness is in developer preview; unreviewed versions must pass the compatibility suite before promotion.',
    }
  }

  return {
    expectedVersion: HARNESS_REVIEWED_VERSION,
    detectedVersion,
    compatible: true,
    reason: 'Detected the reviewed Harness compatibility snapshot.',
  }
}
