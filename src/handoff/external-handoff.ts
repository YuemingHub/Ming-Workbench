/**
 * External product Handoff V0.
 *
 * This contract is intentionally product-level and narrow. It is NOT a MingOS
 * Core schema. It exists so products such as Return-to-oneself can hand a
 * user-approved intent to Ming without sharing their full private context.
 */

export const EXTERNAL_HANDOFF_VERSION = '0.1.0' as const

export type ExternalProduct = 'Return-to-oneself' | 'Ming'

export interface UserApprovedHandoffV0 {
  schemaVersion: typeof EXTERNAL_HANDOFF_VERSION
  kind: 'user-approved-handoff'
  sourceProduct: 'Return-to-oneself'
  targetProduct: 'Ming'
  reason: 'create-real-outcome'
  userWords: string
  confirmedIntent: string
  firstOutcome: string
  preferences: string[]
  resources: string[]
  userAuthorization: {
    approved: true
    approvedAt: string
  }
  returnRequested: boolean
  createdAt: string
}

export interface ReturnPacketV0 {
  schemaVersion: typeof EXTERNAL_HANDOFF_VERSION
  kind: 'return-packet'
  sourceProduct: 'Ming'
  targetProduct: 'Return-to-oneself'
  originalIntent: string
  actualOutcome: string
  evidenceSummary: string[]
  humanFeedback: string[]
  openQuestions: string[]
  createdAt: string
}

export interface ExternalHandoffValidationResult {
  valid: boolean
  errors: string[]
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

/**
 * Fail-closed validator for packets entering Ming.
 *
 * The validator deliberately accepts only the explicit V0 surface. Extra
 * private source-product state is rejected instead of silently ignored, so a
 * producer cannot accidentally smuggle conversation history into Ming.
 */
export function validateUserApprovedHandoffV0(
  value: unknown,
): ExternalHandoffValidationResult {
  const errors: string[] = []
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: ['handoff must be an object'] }
  }

  const packet = value as Record<string, unknown>
  const allowedKeys = new Set([
    'schemaVersion',
    'kind',
    'sourceProduct',
    'targetProduct',
    'reason',
    'userWords',
    'confirmedIntent',
    'firstOutcome',
    'preferences',
    'resources',
    'userAuthorization',
    'returnRequested',
    'createdAt',
  ])

  for (const key of Object.keys(packet)) {
    if (!allowedKeys.has(key)) errors.push(`unexpected field: ${key}`)
  }

  if (packet.schemaVersion !== EXTERNAL_HANDOFF_VERSION) errors.push('unsupported schemaVersion')
  if (packet.kind !== 'user-approved-handoff') errors.push('invalid kind')
  if (packet.sourceProduct !== 'Return-to-oneself') errors.push('invalid sourceProduct')
  if (packet.targetProduct !== 'Ming') errors.push('invalid targetProduct')
  if (packet.reason !== 'create-real-outcome') errors.push('invalid reason')
  if (!isNonEmptyString(packet.userWords)) errors.push('userWords is required')
  if (!isNonEmptyString(packet.confirmedIntent)) errors.push('confirmedIntent is required')
  if (!isNonEmptyString(packet.firstOutcome)) errors.push('firstOutcome is required')
  if (!isStringArray(packet.preferences)) errors.push('preferences must be a string array')
  if (!isStringArray(packet.resources)) errors.push('resources must be a string array')
  if (typeof packet.returnRequested !== 'boolean') errors.push('returnRequested must be boolean')
  if (!isNonEmptyString(packet.createdAt)) errors.push('createdAt is required')

  const authorization = packet.userAuthorization
  if (!authorization || typeof authorization !== 'object' || Array.isArray(authorization)) {
    errors.push('userAuthorization is required')
  } else {
    const auth = authorization as Record<string, unknown>
    const authKeys = Object.keys(auth)
    if (authKeys.some((key) => key !== 'approved' && key !== 'approvedAt')) {
      errors.push('userAuthorization contains unexpected fields')
    }
    if (auth.approved !== true) errors.push('userAuthorization.approved must be true')
    if (!isNonEmptyString(auth.approvedAt)) errors.push('userAuthorization.approvedAt is required')
  }

  return { valid: errors.length === 0, errors }
}

export function assertUserApprovedHandoffV0(value: unknown): UserApprovedHandoffV0 {
  const result = validateUserApprovedHandoffV0(value)
  if (!result.valid) {
    throw new Error(`Invalid external handoff: ${result.errors.join('; ')}`)
  }
  return value as UserApprovedHandoffV0
}
