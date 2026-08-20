/**
 * Capability Resolution V0.
 *
 * This is deliberately a small, Work-Unit-bound decision made before an
 * executor is selected.  The need is stable product language; the current
 * implementation is an adapter detail.  V0 does not search the network or
 * create/install capabilities.  When the reviewed AAOP + Harness + Git +
 * verification chain is available, it records reuse honestly.
 */

import { existsSync } from 'node:fs'

import type { WorkUnit } from '../core/model.js'

export const SOFTWARE_EXECUTION_CAPABILITY_NEED =
  'bounded software execution with independently verifiable mutation' as const

export type CapabilityDiscoveryStatus =
  | 'NOT_REQUIRED'
  | 'EXTERNAL_SEARCH'
  | 'EXTERNAL_CAPABILITY_USED'
  | 'NOT_PROVEN'

export type ExecutorPortability = 'PROVEN' | 'NOT_PROVEN'

export interface CapabilityAssessment {
  existingCapabilitiesChecked: string[]
  sufficient: boolean
  evidence: string[]
}

export interface CapabilityResolution {
  capability: 'software execution'
  executorRole: 'SoftwareExecutor'
  implementation: 'Harness ACP adapter'
  domainControl: 'AAOP'
  reason: string
}

export interface CapabilityDecision {
  workUnitId: string
  capabilityNeed: typeof SOFTWARE_EXECUTION_CAPABILITY_NEED
  assessment: CapabilityAssessment
  resolution?: CapabilityResolution
  discoveryStatus: CapabilityDiscoveryStatus
  executorPortability: ExecutorPortability
  evidence: string[]
}

export interface ResolveCapabilityOptions {
  workUnit: WorkUnit
  /** The reviewed Harness checkout/capsule selected for this run. */
  harnessCheckout?: string
}

/**
 * Resolve the current software execution capability without inventing an
 * external discovery step.  A missing reviewed checkout is a real capability
 * gap, so the decision is NOT_PROVEN and callers must stay fail-closed.
 */
export function resolveSoftwareExecutionCapability(
  options: ResolveCapabilityOptions,
): CapabilityDecision {
  const checked = [
    'AAOP Developer Intake and execution grant',
    'Git disposable isolation and authorized readback',
    'Harness ACP adapter',
    'repository/test verification projection',
  ]

  const evidence: string[] = [
    `Work Unit ${options.workUnit.id} is owned by ${options.workUnit.owner}.`,
  ]
  const harnessAvailable = Boolean(options.harnessCheckout && existsSync(options.harnessCheckout))
  if (harnessAvailable) {
    evidence.push('A reviewed Harness checkout/capsule is available for this run.')
  } else {
    evidence.push('No reviewed Harness checkout/capsule is available for this run.')
  }

  const sufficient = options.workUnit.owner === 'development-aaop' && harnessAvailable
  if (!sufficient) {
    return {
      workUnitId: options.workUnit.id,
      capabilityNeed: SOFTWARE_EXECUTION_CAPABILITY_NEED,
      assessment: {
        existingCapabilitiesChecked: checked,
        sufficient: false,
        evidence,
      },
      discoveryStatus: 'NOT_PROVEN',
      executorPortability: 'NOT_PROVEN',
      evidence: [
        ...evidence,
        'Existing qualified capabilities were not sufficient for a fail-closed execution selection.',
      ],
    }
  }

  const resolution: CapabilityResolution = {
    capability: 'software execution',
    executorRole: 'SoftwareExecutor',
    implementation: 'Harness ACP adapter',
    domainControl: 'AAOP',
    reason: 'Existing qualified capabilities were sufficient.',
  }

  return {
    workUnitId: options.workUnit.id,
    capabilityNeed: SOFTWARE_EXECUTION_CAPABILITY_NEED,
    assessment: {
      existingCapabilitiesChecked: checked,
      sufficient: true,
      evidence,
    },
    resolution,
    discoveryStatus: 'NOT_REQUIRED',
    executorPortability: 'NOT_PROVEN',
    evidence: [
      ...evidence,
      resolution.reason,
      'Only the Harness execution implementation has been exercised.',
    ],
  }
}
