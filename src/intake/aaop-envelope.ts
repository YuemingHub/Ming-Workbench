import type { AaopRoute } from '../execution/provider-grant.js'

export const AAOP_INTAKE_ENVELOPE_SCHEMA_VERSION = '1.0' as const

export type AaopSituation =
  | 'idea'
  | 'existing_repository'
  | 'defect_failure'
  | 'release_operations'
  | 'understanding_review'

export interface AaopIntakeEnvelope {
  schema_version: '1.0'
  generated_at: string
  raw_request: string
  situation: AaopSituation
  route: AaopRoute
  route_confidence: number
  ambiguities: string[]
  question_needed: string | null
  project_evidence_summary: string[]
  next_action: string
}

const SITUATIONS = new Set<AaopSituation>([
  'idea',
  'existing_repository',
  'defect_failure',
  'release_operations',
  'understanding_review',
])

const ROUTES = new Set<AaopRoute>([
  'idea-to-build',
  'repo-recovery',
  'bug-fix',
  'feature-change',
  'understand-review',
  'release-operations',
])

const FIELDS = new Set([
  'schema_version',
  'generated_at',
  'raw_request',
  'situation',
  'route',
  'route_confidence',
  'ambiguities',
  'question_needed',
  'project_evidence_summary',
  'next_action',
])

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function strictJsonCandidate(text: string): string {
  const trimmed = text.trim()
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed

  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed)
  if (fenced) return fenced[1].trim()

  throw new Error(
    'AAOP Developer Intake coordinator must return only one JSON object (optionally in one JSON code fence), with no surrounding prose.',
  )
}

export function validateAaopIntakeEnvelope(value: unknown): AaopIntakeEnvelope {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('AAOP Intake Envelope must be a JSON object.')
  }
  const record = value as Record<string, unknown>

  const unknownFields = Object.keys(record).filter((field) => !FIELDS.has(field))
  if (unknownFields.length > 0) {
    throw new Error(`AAOP Intake Envelope contains unsupported fields: ${unknownFields.join(', ')}`)
  }

  if (record.schema_version !== AAOP_INTAKE_ENVELOPE_SCHEMA_VERSION) {
    throw new Error(`AAOP Intake Envelope schema_version must be ${AAOP_INTAKE_ENVELOPE_SCHEMA_VERSION}.`)
  }
  if (typeof record.generated_at !== 'string' || record.generated_at.trim().length === 0) {
    throw new Error('AAOP Intake Envelope generated_at is required.')
  }
  if (typeof record.raw_request !== 'string' || record.raw_request.trim().length === 0) {
    throw new Error('AAOP Intake Envelope raw_request is required.')
  }
  if (typeof record.situation !== 'string' || !SITUATIONS.has(record.situation as AaopSituation)) {
    throw new Error(`AAOP Intake Envelope has unsupported situation: ${String(record.situation)}`)
  }
  if (typeof record.route !== 'string' || !ROUTES.has(record.route as AaopRoute)) {
    throw new Error(`AAOP Intake Envelope has unsupported route: ${String(record.route)}`)
  }
  if (
    typeof record.route_confidence !== 'number'
    || !Number.isFinite(record.route_confidence)
    || record.route_confidence < 0
    || record.route_confidence > 1
  ) {
    throw new Error('AAOP Intake Envelope route_confidence must be a number between 0 and 1.')
  }
  if (!isStringArray(record.ambiguities)) {
    throw new Error('AAOP Intake Envelope ambiguities must be a string array.')
  }
  if (record.question_needed !== null && typeof record.question_needed !== 'string') {
    throw new Error('AAOP Intake Envelope question_needed must be a string or null.')
  }
  if (!isStringArray(record.project_evidence_summary)) {
    throw new Error('AAOP Intake Envelope project_evidence_summary must be a string array.')
  }
  if (typeof record.next_action !== 'string' || record.next_action.trim().length === 0) {
    throw new Error('AAOP Intake Envelope next_action is required.')
  }

  return record as unknown as AaopIntakeEnvelope
}

export function parseAaopIntakeEnvelope(text: string): AaopIntakeEnvelope {
  let value: unknown
  try {
    value = JSON.parse(strictJsonCandidate(text))
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`AAOP Intake Envelope is not valid JSON: ${error.message}`)
    }
    throw error
  }
  return validateAaopIntakeEnvelope(value)
}
