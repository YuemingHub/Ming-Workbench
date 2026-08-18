/**
 * Human-first V1 entry — Idea Space state machine.
 *
 * This is the thin pre-repo surface that carries a person from "I have an idea"
 * to a confirmed first real outcome. It owns no project, repository, AAOP,
 * Harness, or execution semantics: it persists conversation, desired reality,
 * larger direction, one recommended smallest complete real outcome, the round
 * agreement, and the human confirmation, then STOPS.
 */

export type HumanFirstStage =
  | 'letter'
  | 'entry'
  | 'conversation'
  | 'review'
  | 'agreement'
  | 'confirmed'

export const HUMAN_FIRST_ENTRIES = [
  '我已经有一个想法',
  '我只有一点模糊念头',
  '我现在也不知道想做什么',
] as const

export type HumanFirstEntry = (typeof HUMAN_FIRST_ENTRIES)[number]

export interface IdeaTurn {
  role: 'human' | 'workbench'
  text: string
  at: string
}

/** The four pre-confirmation review blocks a normal person reads. */
export interface IdeaSynthesis {
  /** 我理解的你想去的地方 */
  desiredReality: string
  /** 你已经带来的东西 (grounded only in what the person said) */
  strengths: string[]
  /** 我们可以怎么一步步走到那里 */
  path: string[]
  /** 我建议先做到这一件事 — one smallest complete real outcome */
  recommendation: string
}

/** Round Agreement — the four required semantics before confirmation. */
export interface RoundAgreement {
  /** 这一轮会得到什么 */
  willGet: string
  /** 它解决什么问题 */
  solves: string
  /** 你会在哪里看到 / 怎么使用它 */
  whereSee: string
  /** 这一轮明确不做什么 */
  notDoing: string
}

export interface HumanFirstIdea {
  id: string
  stage: HumanFirstStage
  entry?: HumanFirstEntry
  turns: IdeaTurn[]
  synthesis?: IdeaSynthesis
  agreement?: RoundAgreement
  confirmedAt?: string
  createdAt: string
  updatedAt: string
}

export function createLetterIdea(now = new Date().toISOString()): HumanFirstIdea {
  return {
    id: 'idea-1',
    stage: 'letter',
    turns: [],
    createdAt: now,
    updatedAt: now,
  }
}

export function beginIdea(idea: HumanFirstIdea, now = new Date().toISOString()): HumanFirstIdea {
  return { ...idea, stage: 'entry', updatedAt: now }
}

function entryGreeting(entry: HumanFirstEntry): string {
  switch (entry) {
    case '我已经有一个想法':
      return '太好了。用一个自然的句子，把你想做成的这件事说给我听就行。'
    case '我只有一点模糊念头':
      return '模糊的念头也可以开始。说说你脑子里反复出现的那些片段，比如最近一件让你花了心思、或者一直想做但没做的小事。'
    case '我现在也不知道想做什么':
      return '那也很好，我们不急。可以聊聊你平时在乎什么、最近什么让你花了比较多时间，慢慢就有了方向。'
  }
}

export function chooseEntry(
  idea: HumanFirstIdea,
  entry: string,
  now = new Date().toISOString(),
): HumanFirstIdea {
  const valid = HUMAN_FIRST_ENTRIES.includes(entry as HumanFirstEntry)
  if (!valid) {
    throw new Error(`Unknown human-first entry: ${entry}`)
  }
  const next: HumanFirstIdea = {
    ...idea,
    stage: 'conversation',
    entry: entry as HumanFirstEntry,
    turns: [
      ...idea.turns,
      { role: 'workbench', text: entryGreeting(entry as HumanFirstEntry), at: now },
    ],
    updatedAt: now,
  }
  return next
}

export function appendHumanTurn(
  idea: HumanFirstIdea,
  text: string,
  now = new Date().toISOString(),
): HumanFirstIdea {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new Error('Message must not be empty')
  }
  return {
    ...idea,
    stage: 'conversation',
    turns: [...idea.turns, { role: 'human', text: trimmed, at: now }],
    updatedAt: now,
  }
}

export function applySynthesis(
  idea: HumanFirstIdea,
  synthesis: IdeaSynthesis,
  reply: string,
  now = new Date().toISOString(),
): HumanFirstIdea {
  return {
    ...idea,
    stage: 'review',
    synthesis,
    turns: [...idea.turns, { role: 'workbench', text: reply, at: now }],
    updatedAt: now,
  }
}

export function applyAgreement(
  idea: HumanFirstIdea,
  agreement: RoundAgreement,
  reply: string,
  now = new Date().toISOString(),
): HumanFirstIdea {
  return {
    ...idea,
    stage: 'agreement',
    agreement,
    turns: [...idea.turns, { role: 'workbench', text: reply, at: now }],
    updatedAt: now,
  }
}

export function confirmIdea(
  idea: HumanFirstIdea,
  now = new Date().toISOString(),
): HumanFirstIdea {
  if (idea.stage !== 'agreement' || !idea.agreement) {
    throw new Error('Cannot confirm before round agreement exists')
  }
  return { ...idea, stage: 'confirmed', confirmedAt: now, updatedAt: now }
}

/** Human turn count — acceptance requires more than one conversation turn. */
export function humanTurnCount(idea: HumanFirstIdea): number {
  return idea.turns.filter((turn) => turn.role === 'human').length
}
