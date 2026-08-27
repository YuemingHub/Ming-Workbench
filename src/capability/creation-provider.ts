import type { Asset } from '../core/model.js'

export interface CreationCapabilityRequest {
  workUnitId: string
  outcome: string
  resources: Asset[]
  workspaceRoot: string
}

export type CreationProviderRunStatus = 'completed' | 'failed'

export interface CreationCapabilityProviderResult {
  runStatus: CreationProviderRunStatus
  summary: string
  /** Provider-reported artifact paths. Workbench MUST independently verify them. */
  artifactPaths: string[]
}

/**
 * Replaceable Creation execution provider.
 *
 * Workbench owns Intent / Work Unit / Outcome Truth. A provider only attempts
 * execution and returns candidate artifact paths. Its own success claim never
 * proves the product outcome.
 */
export interface CreationCapabilityProvider {
  id: string
  execute(request: CreationCapabilityRequest): Promise<CreationCapabilityProviderResult>
}
