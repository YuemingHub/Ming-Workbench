/**
 * P1-6: Repository Write Lease (minimal version).
 *
 * Product rule: a real-world working tree can have at most ONE active direct
 * writer ExecutionRun at a time. Before opening a bounded write run the caller
 * must acquire the lease for the repository; a second write run against the
 * same repository is BLOCKED until the first is terminal/reconciled and the
 * lease is released.
 *
 * Explicitly out of scope (this milestone): worktree orchestration, distributed
 * locks, multi-repo scheduling.
 *
 * The Independent Verifier (purpose='verification') is read-only by default and
 * therefore does NOT need the write lease — it must never be blocked by a
 * writer.
 *
 * A lease is durable (persisted in the Work Unit store) so a Workbench restart
 * can reconcile stale leases: a lease whose owning run is no longer active is
 * released, and a run that crashed while holding the lease is not silently
 * overwritten (UNKNOWN ≠ RETRY — see P1-5).
 */

export interface WriteLease {
  /** The repository working tree the lease applies to (absolute path). */
  repository: string
  /** The single active writer ExecutionRun id. */
  writerRunId: string
  /** The Work Unit the writer belongs to (traceability). */
  workUnitId: string
  grantedAt: string
  /** Terminal statuses that end a lease. */
  released?: boolean
}

export type LeaseAcquisition =
  | { ok: true; lease: WriteLease }
  | { ok: false; reason: 'held-by-other-writer' | 'stale-authority'; heldBy?: WriteLease }

export type LeaseRelease =
  | { ok: true; released: boolean; lease?: WriteLease }
  | { ok: false; reason: 'not-held' | 'held-by-other-writer'; heldBy?: WriteLease }

export interface AcquireLeaseInput {
  repository: string
  writerRunId: string
  workUnitId: string
  /** Current leases in the store. */
  leases: WriteLease[]
  /** The writer run's purpose; a read-only verifier never acquires a lease. */
  purpose?: string
  now?: string
}

/**
 * Acquire the exclusive write lease for a repository.
 *
 * - A run with purpose 'verification' is read-only: it is allowed to run
 *   without a lease (returns ok with no lease).
 * - A write run may proceed only when no other ACTIVE writer holds the lease
 *   for the same repository (released leases are ignored).
 */
export function acquireWriteLease(input: AcquireLeaseInput): LeaseAcquisition {
  const repository = normalizeRepository(input.repository)
  const active = input.leases.find(
    (l) => l.repository === repository && l.released !== true,
  )
  if (input.purpose === 'verification') {
    // Read-only verifier needs no lease and is never blocked by a writer.
    return { ok: true, lease: undefined as unknown as WriteLease }
  }
  if (active) {
    if (active.writerRunId === input.writerRunId) {
      // Same run re-acquiring (idempotent).
      return { ok: true, lease: active }
    }
    return {
      ok: false,
      reason: 'held-by-other-writer',
      heldBy: active,
    }
  }
  return {
    ok: true,
    lease: {
      repository,
      writerRunId: input.writerRunId,
      workUnitId: input.workUnitId,
      grantedAt: input.now ?? new Date().toISOString(),
      released: false,
    },
  }
}

/**
 * Release the lease held by a run. Only the lease holder may release it; a
 * second writer must never clear another writer's lease.
 */
export function releaseWriteLease(
  leases: WriteLease[],
  repository: string,
  writerRunId: string,
): LeaseRelease {
  const normalized = normalizeRepository(repository)
  const lease = leases.find((l) => l.repository === normalized && l.released !== true)
  if (!lease) return { ok: true, released: false }
  if (lease.writerRunId !== writerRunId) {
    return { ok: false, reason: 'held-by-other-writer', heldBy: lease }
  }
  const released: WriteLease = { ...lease, released: true }
  return { ok: true, released: true, lease: released }
}

export interface ReconcileStaleLeasesInput {
  leases: WriteLease[]
  /** A function that returns true when the run is terminal (completed/failed/interrupted/orphaned). */
  isTerminalRun: (runId: string) => boolean
  now?: string
}

/**
 * Restart reconciliation: a lease whose owning run is no longer active is a
 * stale lease and is released. This is safe — it never re-runs anything; it
 * only frees the working tree for a future, correctly authorized attempt.
 */
export function reconcileStaleLeases(input: ReconcileStaleLeasesInput): {
  leases: WriteLease[]
  releasedStale: string[]
} {
  const releasedStale: string[] = []
  const leases = input.leases.map((lease) => {
    if (lease.released !== true && input.isTerminalRun(lease.writerRunId)) {
      releasedStale.push(lease.writerRunId)
      return { ...lease, released: true }
    }
    return lease
  })
  return { leases, releasedStale }
}

/** Normalize a repository path for lease keying. */
function normalizeRepository(repository: string): string {
  // Trailing slashes and dot-segments are common; the lease key is the
  // resolved absolute path so 'a/b' and 'a/b/' collide correctly.
  return repository.replace(/[\\/]+$/, '')
}
