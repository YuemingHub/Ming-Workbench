/**
 * Human-first V1 entry — Idea Space persistence.
 *
 * A single small JSON file in the store directory (userData in desktop mode),
 * same discipline as the Work Unit store: best-effort writes, schema mismatch
 * treated as empty, persisted content is product state only and carries no
 * provider secrets.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
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
