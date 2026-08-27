/**
 * Human-first V1 entry — Idea Space persistence.
 *
 * Small JSON files in the store directory (userData in desktop mode, or a
 * local .ming-workbench store in pure web mode). Best-effort writes, schema
 * mismatch treated as empty, persisted content is product state only.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import {
  createLetterIdea,
  type HumanFirstIdea,
  type HumanFirstStage,
  type IdeaSynthesis,
  type IdeaTurn,
  type RoundAgreement,
} from './idea-space.js'

export const IDEA_STORE_FILE_NAME = 'human-first-idea.json'
export const IDEA_STORE_VERSION = 1

export const PROVIDER_SECRET_FILE_NAME = 'provider-secret.txt'
export const PROVIDER_PREFS_FILE_NAME = 'provider-preferences.json'

interface PersistedIdea {
  storeVersion: number
  idea: {
    id: string
    stage: HumanFirstStage
    entry?: string
    turns: IdeaTurn[]
    synthesis?: IdeaSynthesis
    agreement?: RoundAgreement
    confirmedAt?: string
    createdAt: string
    updatedAt: string
  }
}

/** Non-secret provider preferences (model + optional baseUrl). */
export interface ProviderPreferences {
  provider: string
  model: string
  baseUrl: string
}

function defaultProviderPreferences(): ProviderPreferences {
  return { provider: 'deepseek-official', model: 'deepseek-v4-pro', baseUrl: '' }
}

function normalizeProviderPreferences(value: unknown): ProviderPreferences {
  const base = defaultProviderPreferences()
  if (!value || typeof value !== 'object') return base
  const obj = value as Record<string, unknown>
  const provider = typeof obj.provider === 'string' ? obj.provider.trim() : ''
  const model = typeof obj.model === 'string' ? obj.model.trim() : ''
  const baseUrl = typeof obj.baseUrl === 'string' ? obj.baseUrl.trim() : ''
  const out = { ...base }
  if (provider && provider.length <= 200) out.provider = provider
  if (model && model.length <= 200) out.model = model
  if (baseUrl.length <= 500) out.baseUrl = baseUrl
  return out
}

function ensureDir(storeDir: string): void {
  mkdirSync(storeDir, { recursive: true })
}

// ── Provider secret (file-based, pure-web safe) ───────────────────────────

function secretPath(storeDir: string): string {
  return join(storeDir, PROVIDER_SECRET_FILE_NAME)
}

export function loadProviderSecretFile(storeDir: string): string | null {
  try {
    if (!storeDir || !existsSync(secretPath(storeDir))) return null
    const value = readFileSync(secretPath(storeDir), 'utf8').trim()
    return value.length > 0 ? value : null
  } catch {
    return null
  }
}

export function saveProviderSecretFile(storeDir: string, secret: string): void {
  try {
    if (!storeDir) return
    ensureDir(storeDir)
    writeFileSync(secretPath(storeDir), `${secret}\n`, 'utf8')
  } catch {
    // Best-effort.
  }
}

export function clearProviderSecretFile(storeDir: string): void {
  try {
    if (!storeDir) return
    const path = secretPath(storeDir)
    if (existsSync(path)) rmSync(path, { force: true })
  } catch {
    // Best-effort.
  }
}

// ── Provider preferences (non-secret, plain JSON) ──────────────────────────

function prefsPath(storeDir: string): string {
  return join(storeDir, PROVIDER_PREFS_FILE_NAME)
}

export function loadProviderPreferencesFile(storeDir: string): ProviderPreferences {
  try {
    if (!storeDir || !existsSync(prefsPath(storeDir))) return defaultProviderPreferences()
    return normalizeProviderPreferences(JSON.parse(readFileSync(prefsPath(storeDir), 'utf8')))
  } catch {
    return defaultProviderPreferences()
  }
}

export function saveProviderPreferencesFile(
  storeDir: string,
  prefs: ProviderPreferences,
): ProviderPreferences {
  const normalized = normalizeProviderPreferences(prefs)
  try {
    if (storeDir) {
      ensureDir(storeDir)
      writeFileSync(
        prefsPath(storeDir),
        `${JSON.stringify(normalized, null, 2)}\n`,
        'utf8',
      )
    }
  } catch {
    // Best-effort.
  }
  return normalized
}

function isValidIdea(value: unknown): value is HumanFirstIdea {
  if (!value || typeof value !== 'object') return false
  const idea = value as Record<string, unknown>
  return (
    typeof idea.id === 'string'
    && typeof idea.stage === 'string'
    && Array.isArray(idea.turns)
    && typeof idea.createdAt === 'string'
    && typeof idea.updatedAt === 'string'
  )
}

function ideaPath(storeDir: string): string {
  return join(storeDir, IDEA_STORE_FILE_NAME)
}

/** Load the persisted idea, or a fresh letter idea when absent/invalid. */
export function loadIdea(storeDir: string): HumanFirstIdea {
  try {
    if (!storeDir || !existsSync(ideaPath(storeDir))) return createLetterIdea()
    const raw = JSON.parse(readFileSync(ideaPath(storeDir), 'utf8')) as Partial<PersistedIdea>
    if (!raw || raw.storeVersion !== IDEA_STORE_VERSION || !isValidIdea(raw.idea)) {
      return createLetterIdea()
    }
    return raw.idea as HumanFirstIdea
  } catch {
    return createLetterIdea()
  }
}

export function saveIdea(storeDir: string, idea: HumanFirstIdea): void {
  try {
    mkdirSync(storeDir, { recursive: true })
    const persisted: PersistedIdea = {
      storeVersion: IDEA_STORE_VERSION,
      idea,
    }
    writeFileSync(ideaPath(storeDir), `${JSON.stringify(persisted, null, 2)}\n`, 'utf8')
  } catch {
    // Best-effort persistence; never block the product flow on a save error.
  }
}
