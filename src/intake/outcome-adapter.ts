/**
 * Workbench Outcome → AAOP Intake adapter.
 *
 * The Idea Space is the thin pre-repo surface that carries a person from "I have
 * an idea" to a confirmed smallest complete real outcome, then STOPS. Nothing
 * downstream of confirmation consumes that outcome today; the intake
 * application only accepts a plain `rawRequest` string supplied by the browser
 * or a test fixture.
 *
 * This module is the single seam between the two: it derives the AAOP Developer
 * Intake `rawRequest` from a confirmed HumanFirstIdea and the project the
 * human selected to develop it in. It owns no project, repository, AAOP,
 * Harness, or execution semantics — it only translates the confirmed outcome
 * into the ordinary-language string AAOP intake already expects, and refuses to
 * cross the seam before the idea is actually confirmed.
 */

import type { HumanFirstIdea } from '../idea/idea-space.js'

export interface OutcomeIntakeProject {
  projectRoot: string
  trustedProject: boolean
}

export interface OutcomeIntakeOptions {
  rawRequest: string
  projectRoot: string
  trustedProject: boolean
}

function assertConfirmedIdea(idea: HumanFirstIdea): void {
  if (idea.stage !== 'confirmed') {
    throw new Error(
      `Cannot adapt an unconfirmed idea (stage ${idea.stage}) to AAOP intake. The round agreement must be confirmed first.`,
    )
  }
  if (!idea.synthesis) {
    throw new Error('Confirmed idea is missing its synthesis; cannot derive an intake request.')
  }
  if (!idea.agreement) {
    throw new Error('Confirmed idea is missing its round agreement; cannot derive an intake request.')
  }
}

/**
 * Render the ordinary-language Developer Intake request from a confirmed idea.
 *
 * The recommendation is the smallest complete real outcome the human agreed to;
 * the round agreement carries what this round will get and what problem it
 * solves. AAOP remains responsible for situation, route, scope, and acceptance
 * — this string is only the human-confirmed outcome AAOP grounds against
 * current project evidence.
 */
export function renderIntakeRequestFromOutcome(idea: HumanFirstIdea): string {
  assertConfirmedIdea(idea)
  const { synthesis, agreement } = idea
  const parts: string[] = [synthesis!.recommendation]
  parts.push(`本轮会得到：${agreement!.willGet}`)
  parts.push(`解决：${agreement!.solves}`)
  return parts.join('；')
}

/**
 * Adapt a confirmed HumanFirstIdea plus the selected project into the options
 * the AAOP Developer Intake application expects. This is the boundary a future
 * Workbench UI crosses when a person confirms an idea and picks the project to
 * develop it in.
 */
export function adaptConfirmedIdeaToIntakeOptions(
  idea: HumanFirstIdea,
  project: OutcomeIntakeProject,
): OutcomeIntakeOptions {
  return {
    rawRequest: renderIntakeRequestFromOutcome(idea),
    projectRoot: project.projectRoot,
    trustedProject: project.trustedProject,
  }
}
