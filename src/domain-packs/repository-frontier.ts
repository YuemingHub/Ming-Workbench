export type ActiveWorkKind = 'pull-request' | 'branch' | 'issue'

export interface ActiveWorkItem {
  id: string
  title: string
  kind: ActiveWorkKind
  changedFiles: string[]
  url?: string
}

export interface RepositoryFrontier {
  repository: string
  baseRef: string
  observedAt: string
  activeWork: ActiveWorkItem[]
}

export interface FrontierConflict {
  workItemId: string
  workItemTitle: string
  overlappingFiles: string[]
}

export type FrontierDecisionKind = 'safe' | 'conflict' | 'scope-required'

export interface FrontierDecision {
  kind: FrontierDecisionKind
  safeToStart: boolean
  conflicts: FrontierConflict[]
  occupiedFiles: string[]
  reason: string
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '')
}

export function collectOccupiedFiles(frontier: RepositoryFrontier): string[] {
  return [
    ...new Set(
      frontier.activeWork.flatMap((work) => work.changedFiles.map(normalizePath)),
    ),
  ].sort()
}

/**
 * Decide whether a proposed development slice can start without colliding with
 * currently active repository work.
 *
 * This function deliberately refuses to infer safety when the proposed file
 * surface is unknown. Repository evidence must establish a non-overlapping
 * target before Workbench can call the slice safe to start.
 */
export function assessRepositoryFrontier(
  frontier: RepositoryFrontier,
  intendedFiles: string[],
): FrontierDecision {
  const occupiedFiles = collectOccupiedFiles(frontier)
  const normalizedIntent = [...new Set(intendedFiles.map(normalizePath))].sort()

  if (normalizedIntent.length === 0) {
    return {
      kind: 'scope-required',
      safeToStart: false,
      conflicts: [],
      occupiedFiles,
      reason:
        'The intended file surface is not yet known, so Workbench cannot prove this slice is conflict-free.',
    }
  }

  const conflicts = frontier.activeWork
    .map((work) => {
      const workFiles = new Set(work.changedFiles.map(normalizePath))
      const overlappingFiles = normalizedIntent.filter((file) => workFiles.has(file))
      return {
        workItemId: work.id,
        workItemTitle: work.title,
        overlappingFiles,
      }
    })
    .filter((conflict) => conflict.overlappingFiles.length > 0)

  if (conflicts.length > 0) {
    return {
      kind: 'conflict',
      safeToStart: false,
      conflicts,
      occupiedFiles,
      reason:
        'The proposed slice overlaps active repository work and must be rerouted, narrowed, or explicitly handed off before implementation.',
    }
  }

  return {
    kind: 'safe',
    safeToStart: true,
    conflicts: [],
    occupiedFiles,
    reason: 'The proposed file surface does not overlap the observed active work.',
  }
}
