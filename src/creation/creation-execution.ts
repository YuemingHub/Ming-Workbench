import { randomUUID } from 'node:crypto'
import { realpathSync, statSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'

import type { Asset, Evidence, WorkUnit } from '../core/model.js'
import { canMarkCompleted } from '../core/model.js'
import type { CreationCapabilityProvider } from '../capability/creation-provider.js'

export interface ExecuteCreationOptions {
  workUnit: WorkUnit
  provider: CreationCapabilityProvider
  workspaceRoot: string
  now?: () => Date
  idFactory?: () => string
}

export type CreationExecutionStatus = 'awaiting-human' | 'blocked'

export interface CreationExecutionResult {
  status: CreationExecutionStatus
  workUnit: WorkUnit
  providerId: string
  verifiedArtifactPaths: string[]
  summary: string
}

function cloneWorkUnit(unit: WorkUnit): WorkUnit {
  return {
    ...unit,
    gate: { ...unit.gate },
    acceptance: unit.acceptance.map((criterion) => ({
      ...criterion,
      evidenceIds: [...criterion.evidenceIds],
    })),
    evidence: unit.evidence.map((item) => ({ ...item })),
    assets: unit.assets.map((asset) => ({ ...asset })),
  }
}

function pathInsideRoot(path: string, root: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !resolve(rel).startsWith(sep))
}

function verifyArtifactPath(candidate: string, workspaceRoot: string): string {
  const root = realpathSync(resolve(workspaceRoot))
  const requested = resolve(workspaceRoot, candidate)
  const actual = realpathSync(requested)
  if (!pathInsideRoot(actual, root)) {
    throw new Error(`artifact escapes Creation workspace: ${candidate}`)
  }
  const stat = statSync(actual)
  if (!stat.isFile()) throw new Error(`artifact is not a file: ${candidate}`)
  if (stat.size <= 0) throw new Error(`artifact is empty: ${candidate}`)
  return actual
}

function blockCreation(
  unit: WorkUnit,
  summary: string,
  now: () => Date,
): WorkUnit {
  const next = cloneWorkUnit(unit)
  next.state = 'blocked'
  next.gate = { kind: 'none', open: false }
  next.nextFrontier = summary
  next.updatedAt = now().toISOString()
  return next
}

/**
 * Execute a Creation Work Unit through a replaceable provider, then independently
 * read the provider-reported artifacts from reality.
 *
 * A provider saying `completed` is never enough. Only non-empty files whose
 * real paths remain inside the Workbench-owned Creation workspace become
 * authoritative evidence.
 *
 * Even after verification, the Work Unit remains `needs-human`: verification
 * proves the artifact exists, not that the person accepts it as their outcome.
 */
export async function executeCreationWorkUnit(
  options: ExecuteCreationOptions,
): Promise<CreationExecutionResult> {
  const now = options.now ?? (() => new Date())
  const idFactory = options.idFactory ?? (() => randomUUID())

  if (options.workUnit.owner !== 'creation') {
    throw new Error(`Work Unit ${options.workUnit.id} is not owned by Creation.`)
  }
  if (options.workUnit.gate.open) {
    throw new Error(`Work Unit ${options.workUnit.id} has an open gate; cannot execute.`)
  }
  if (options.workUnit.state === 'completed') {
    throw new Error(`Work Unit ${options.workUnit.id} is already completed.`)
  }
  if (options.workUnit.acceptance.length === 0) {
    throw new Error(`Creation Work Unit ${options.workUnit.id} has no acceptance criterion.`)
  }

  const providerResult = await options.provider.execute({
    workUnitId: options.workUnit.id,
    outcome: options.workUnit.outcome,
    resources: options.workUnit.assets,
    workspaceRoot: resolve(options.workspaceRoot),
  })

  if (providerResult.runStatus !== 'completed') {
    return {
      status: 'blocked',
      workUnit: blockCreation(
        options.workUnit,
        providerResult.summary || 'Creation provider did not complete.',
        now,
      ),
      providerId: options.provider.id,
      verifiedArtifactPaths: [],
      summary: providerResult.summary || 'Creation provider did not complete.',
    }
  }

  const verifiedPaths: string[] = []
  try {
    for (const candidate of providerResult.artifactPaths) {
      verifiedPaths.push(verifyArtifactPath(candidate, options.workspaceRoot))
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      status: 'blocked',
      workUnit: blockCreation(options.workUnit, message, now),
      providerId: options.provider.id,
      verifiedArtifactPaths: [],
      summary: message,
    }
  }

  if (verifiedPaths.length === 0) {
    const summary = 'Creation provider completed but produced no independently verifiable artifact.'
    return {
      status: 'blocked',
      workUnit: blockCreation(options.workUnit, summary, now),
      providerId: options.provider.id,
      verifiedArtifactPaths: [],
      summary,
    }
  }

  const next = cloneWorkUnit(options.workUnit)
  const timestamp = now().toISOString()
  const evidenceIds: string[] = []
  const newAssets: Asset[] = []
  const newEvidence: Evidence[] = []

  verifiedPaths.forEach((path, index) => {
    const evidenceId = `EV-${next.id}-ARTIFACT-${idFactory()}`
    evidenceIds.push(evidenceId)
    newEvidence.push({
      id: evidenceId,
      kind: 'artifact',
      summary: `Independent readback verified a non-empty artifact inside the Creation workspace: ${path}`,
      uri: path,
      observedAt: timestamp,
      authoritative: true,
      verifier: 'independent-verification',
      verification: 'passed',
    })
    newAssets.push({
      id: `AS-${next.id}-ARTIFACT-${index + 1}`,
      kind: 'other',
      title: `Creation artifact ${index + 1}`,
      uri: path,
    })
  })

  next.evidence.push(...newEvidence)
  next.assets.push(...newAssets)
  next.acceptance = next.acceptance.map((criterion) => ({
    ...criterion,
    evidenceIds: [...evidenceIds],
  }))
  next.state = 'needs-human'
  next.gate = {
    kind: 'human-decision',
    open: true,
    owner: 'human',
    summary: 'The artifact exists and passed independent readback. The person must decide whether it is the outcome they wanted.',
  }
  next.nextFrontier = 'Show the verified artifact to the person and wait for acceptance, rejection, or revision feedback.'
  next.updatedAt = timestamp

  return {
    status: 'awaiting-human',
    workUnit: next,
    providerId: options.provider.id,
    verifiedArtifactPaths: verifiedPaths,
    summary: 'Artifact produced and independently verified; human acceptance is still pending.',
  }
}

export function acceptCreationWorkUnit(
  unit: WorkUnit,
  options: { now?: () => Date; idFactory?: () => string } = {},
): WorkUnit {
  const now = options.now ?? (() => new Date())
  const idFactory = options.idFactory ?? (() => randomUUID())
  if (unit.owner !== 'creation') throw new Error('Only Creation Work Units can use Creation acceptance.')
  if (unit.state !== 'needs-human' || unit.gate.kind !== 'human-decision' || !unit.gate.open) {
    throw new Error('Creation Work Unit is not waiting for human acceptance.')
  }

  const next = cloneWorkUnit(unit)
  const timestamp = now().toISOString()
  next.evidence.push({
    id: `EV-${next.id}-HUMAN-${idFactory()}`,
    kind: 'human-confirmation',
    summary: 'The person explicitly accepted the verified Creation outcome.',
    observedAt: timestamp,
    authoritative: true,
    verifier: 'human-confirmation',
    verification: 'passed',
  })
  next.gate = { kind: 'none', open: false }
  next.state = 'completed'
  next.nextFrontier = undefined
  next.updatedAt = timestamp

  if (!canMarkCompleted(next)) {
    throw new Error('Creation Work Unit cannot complete without verification-backed acceptance evidence.')
  }
  return next
}

export function rejectCreationWorkUnit(
  unit: WorkUnit,
  feedback: string,
  options: { now?: () => Date; idFactory?: () => string } = {},
): WorkUnit {
  const trimmed = feedback.trim()
  if (!trimmed) throw new Error('Rejection/revision feedback must not be empty.')
  const now = options.now ?? (() => new Date())
  const idFactory = options.idFactory ?? (() => randomUUID())
  if (unit.owner !== 'creation') throw new Error('Only Creation Work Units can use Creation rejection.')
  if (unit.state !== 'needs-human' || unit.gate.kind !== 'human-decision' || !unit.gate.open) {
    throw new Error('Creation Work Unit is not waiting for human review.')
  }

  const next = cloneWorkUnit(unit)
  const timestamp = now().toISOString()
  next.evidence.push({
    id: `EV-${next.id}-HUMAN-${idFactory()}`,
    kind: 'human-confirmation',
    summary: `The person did not accept this version and requested revision: ${trimmed}`,
    observedAt: timestamp,
    authoritative: true,
    verifier: 'human-confirmation',
    verification: 'passed',
  })
  next.state = 'ready'
  next.gate = { kind: 'none', open: false }
  next.nextFrontier = `Revise the Creation outcome using only the person's feedback: ${trimmed}`
  next.updatedAt = timestamp
  return next
}
