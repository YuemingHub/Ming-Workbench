---
name: end-to-end-delivery
description: Coordinate a non-technical or novice owner from a rough idea or partial implementation through a verified real deliverable by sequencing existing AAOP routes. This is not a seventh route or a new workflow engine; use it when the user's goal spans multiple route transitions such as idea -> build -> iterate -> release/target acceptance.
---

# End-to-End Delivery Journey

Use this Skill when the user's desired outcome is broader than one engineering task: for example, “I have an idea; help me make it real,” “this partially built app needs to become a real released product,” or “this Skill/library/CLI needs to become something another person can actually install and use.”

This Skill does **not** replace AAOP routes. It coordinates them over time.

## Core contract

The user supplies goals, domain truth, material product decisions, credentials/authorization when needed, and consequential production/publication/install/legal approval when that action is genuinely theirs to own.

AAOP owns the engineering process:

- inspect before asking;
- infer the **current** route from present evidence rather than Journey position;
- recover the actual deliverable, intended consumer, and observable target before defining completion;
- choose the smallest evidence-bearing next step;
- make ordinary reversible engineering decisions autonomously;
- verify before claiming completion;
- reroute only when evidence changes the problem;
- preserve resumable Journey checkpoints without treating them as current truth;
- revalidate the checkpoint revision immediately before mutating continuity state;
- scope target verification to the current release cycle;
- do not make a novice choose frameworks, databases, Agent topology, MCP servers, provider/runtime machinery, or release mechanics unless a real user-owned constraint requires it.

The default experience is one natural-language surface. The user should be able to begin with:

> I want to build …

or simply:

> I want this project to actually work for people.

and continue without learning AAOP's internal vocabulary.

## Canonical definition and checkpoint

The canonical Journey definition lives at `../../journeys/idea-to-production.json`.

For a long-running Journey, maintain a lightweight continuity checkpoint with:

```bash
python .aaop/tools/journey.py status idea-to-production --json
python .aaop/tools/journey.py start idea-to-production --goal "<long-horizon product outcome>" --route <current-route>
python .aaop/tools/journey.py checkpoint idea-to-production --expected-revision <revision-from-latest-status> ...
```

The checkpoint lives under `.aaop/runtime/journeys/` and is preserved across AAOP upgrades. It records the original goal, current release cycle, current gate/route, evidence, blockers, route history, completed release history, next action, and a monotonic `revision` used as a compare-and-swap token.

**It is not a workflow engine or source of truth.** At the start of a new session, reconcile the saved checkpoint against current repository/runtime/artifact/target evidence and project instructions. If they disagree, current evidence wins and the checkpoint must be updated rather than forcing the old plan.

Do not overwrite an existing Journey checkpoint merely because a new conversation started. Do not silently stamp a stale Journey definition current: reconciliation requires current evidence.

### Checkpoint ownership and stale-write protection

The Journey checkpoint has one logical writer: the primary orchestration/coordinator context that owns the current Route decision.

Before every checkpoint mutation:

1. read `python .aaop/tools/journey.py status idea-to-production --json`;
2. reconcile that state with current project/runtime/artifact/target evidence;
3. take the returned `revision` as the write precondition;
4. call `checkpoint ... --expected-revision <revision>`;
5. if the tool reports a stale revision, do **not** retry the same command blindly — re-read the newer checkpoint, preserve the concurrent change, recompute the intended update, and only then write from the new revision.

`journey.py` serializes mutations with an OS file lock and compares the caller's expected revision while holding that lock. Every successful mutation increments the revision. This prevents a stale coordinator/session from overwriting evidence, blockers, Route changes, or release state written by another coordinator.

When specialist agents or parallel workers are used:

- they may inspect the checkpoint and project evidence;
- they return bounded findings, test results, diffs, or review evidence to the coordinator;
- they do **not** independently mutate the Journey checkpoint in parallel;
- the coordinator re-reads current evidence and the latest revision, then serializes the checkpoint update after integrating the relevant findings.

This avoids last-writer-wins state loss without introducing a database, queue, distributed lock service, or second workflow runtime. The file lock protects the local mutation critical section; the revision token protects the engineering decision from being written against stale continuity state.

Legacy checkpoints from v0.21.0/v0.21.1 have no stored revision. `status --json` exposes them as revision `0`; their first mutation under the new contract must explicitly use `--expected-revision 0`, which migrates the checkpoint to a positive revision instead of silently pretending the old state was current.

## Journey shape

A common greenfield release cycle is:

```text
rough idea
  -> idea-to-build
  -> first real consumer-observable slice
  -> feature-change / bug-fix loops as evidence demands
  -> release candidate
  -> release-operations
  -> real deliverable reaches its intended target/consumer
  -> direct current-cycle target evidence
  -> release cycle complete
```

But this is **not** a mandatory route order or a mandatory deployment shape.

- An existing trustworthy implementation may start at `feature-change`, `bug-fix`, `understand-review`, or `release-operations`.
- `repo-recovery` may interrupt whenever the current repository cannot be trusted.
- `understand-review` is used when a material decision must be made before mutation, not as ceremonial review after every change.
- A Journey gate may be skipped when current evidence already proves its exit condition.
- A Web deployment is required only when a deployed service/application is the actual accepted target.
- A Skill/plugin may instead need a clean supported host that discovers/loads the exact artifact and passes representative tasks.
- A library/package may instead need a clean consumer using the exact released artifact.
- A CLI may instead need an installed command executing the accepted behavior.
- These are examples, not a taxonomy that projects must fit.

Do not force an existing project back through greenfield discovery or toward an unrelated production deployment merely because the long-horizon goal is “take it all the way.”

## Gate 0 — Intake without a questionnaire

Load `../developer-intake/SKILL.md`.

Resolve, from the user's words and accessible evidence:

- who the first actor/consumer is;
- the concrete situation;
- the long-horizon observable improvement;
- the actual deliverable shape when it can change completion;
- the real target/consumer context where the deliverable must work;
- hard constraints versus preferences versus solution hypotheses;
- the immediate problem/uncertainty that determines the **current route**.

Ask at most one concrete question at a time, and only when inspection cannot resolve an outcome-blocking user-owned fact.

Do not ask the user what stack to use or what technical delivery shape to choose when current evidence can resolve it.

After selecting the current route, create the Journey checkpoint if one does not already exist. If it exists, reconcile it instead of restarting the Journey.

For a default autonomous takeover, reconstruct the long-horizon intent before selecting
the current development goal. The current goal is the highest-value evidence-backed
result that can be advanced now; it is not a roadmap item the novice must provide.
Choose it from current safety/target evidence, broken acceptance paths, incomplete
core journeys, current defects, accepted milestones, and only then reliability work
that blocks the next outcome. If evidence cannot recover a bounded product outcome and
a material value fork remains, ask one concrete human-owned question; otherwise make a
reversible evidence-bearing move.

## Gate 1 — First evidence-bearing slice, only when needed

Enter `idea-to-build` **only when there is no trustworthy existing slice from which to continue**.

Define a first slice that:

- serves one actor/consumer in one situation;
- has an observable acceptance path;
- explicitly excludes non-essential scope;
- reduces at least one material product or execution uncertainty;
- can be implemented with the minimum reversible technical shape.

A generated scaffold is not sufficient unless the scaffold itself tests a real uncertainty.

If an existing project already has a trustworthy usable slice, skip this gate and route from the actual current delta instead of pretending the project is greenfield.

For novice usability, keep the internal task queue small. Prefer one current outcome and one next executable task over a large speculative roadmap.

## Gate 2 — Project/bootstrap readiness

Before implementation, determine what already exists.

- If there is no trustworthy implementation, create only the minimum project shape needed by the first slice.
- If an existing repository is contradictory or its baseline cannot be trusted, reroute to `repo-recovery`.
- Reuse repository-native scripts, tests, CI, packaging/install configuration, and host capabilities before adding tooling.
- Environment problems are blockers, not automatic reasons to install an agent runtime.
- Reconcile the Journey checkpoint with the current project baseline before resuming mutation.

Historical source: the former `solo-dev-autopilot` environment-detect/env-setup/project-scaffold practices informed this gate, but AAOP keeps the decision at route/capability level rather than requiring a fixed scaffold workflow.

## Gate 3 — Implementation loop

For each coherent change:

1. re-read the current baseline and relevant project rules;
2. prove the current delta still exists;
3. implement the smallest coherent change;
4. run the strongest practical local verification;
5. classify failures before retrying;
6. stop repeated blind retries and re-diagnose when evidence is not changing;
7. inspect the diff for unrelated changes and sensitive data;
8. re-read the Journey status/revision and checkpoint meaningful new evidence and the next decision.

### Default takeover next-delta loop

After every coherent result, do not stop at a plan, handoff, one completed task, or
local green checks. Reconcile the current baseline and existing continuity state, then
select the next highest-value safe delta from the recovered intent and current evidence.
Continue this loop while an authorized, evidence-backed delta exists. Diagnose failed
verification before retrying; re-route when the evidence changes the owning Route; and
preserve a precise blocker only when the remaining boundary is human-owned, unavailable,
or otherwise legitimately blocked.

This is coordination over existing Routes and Working Contract/Journey state, not a second planner, workflow engine, state database, or default Provider. A route-level verified no-op closes only that route decision. Journey completion still requires the current release cycle's direct target evidence under Gate 8.

Prefer project-declared validation commands. Where applicable, use the familiar sequence:

```text
format -> lint -> typecheck -> build -> tests -> runtime/artifact/acceptance check
```

Skip irrelevant steps; do not invent checks merely to satisfy ceremony.

This absorbs the useful core of `solo-dev-autopilot`'s dev-loop/test-runner/code-review practices without forcing its old fixed Skill topology.

### Verification debt containment during continuation

A verification capability may be blocked while other project work remains executable. Do not stop the whole project merely because one validation path is unavailable, but also do not treat an unverified mutation as a trusted baseline for an indefinitely growing dependent chain.

- keep the affected acceptance state unknown;
- record which later deltas depend on that unverified surface;
- continue genuinely independent frontier;
- bound dependent changes as consequence/coupling/failure-localization cost grows;
- prioritize restoring the missing verification capability before critical/release/shared-runtime debt compounds;
- retire all material verification debt required by the acceptance contract before merge/release/delivery/completion.

If the preferred verification path would incur unauthorized monetary cost, do not spend by default and do not lower the acceptance standard. Prefer an already-available local/project-native/self-hosted equivalent; otherwise preserve the evidence gap as unknown.

## Gate 4 — Evidence-driven iteration and anti-thrash

After the first slice is real, do not automatically expand the roadmap.

Use evidence to choose the next route:

- observed defect -> `bug-fix`;
- desired behavior change -> `feature-change`;
- contradictory/untrustworthy project state -> `repo-recovery`;
- decision-only request -> `understand-review`;
- release/delivery/real target acceptance becomes the immediate blocker -> `release-operations`.

A route change must correspond to materially new evidence or a changed blocker classification. The checkpoint tool requires a reason, evidence, and the latest expected revision when changing from one established route to another.

**Do not use rerouting as a substitute for diagnosis.** If the Journey begins bouncing between routes while the underlying evidence is unchanged, stop, classify the blocker, record it, and identify the smallest legitimate unblock condition.

The system should repeatedly ask internally:

> What is the smallest next change that materially improves the user's outcome or reduces the next important uncertainty?

### Execution-continuity escalation — use an existing control plane before inventing one

Repeated no-progress is not automatically evidence that more retries, more agents, or another coding runtime are needed.

When a Journey repeatedly loses progress across turns/sessions, first classify the failure:

- **implementation failure** — code/design/test evidence changed but the implementation is still wrong → remain in the evidence-selected engineering Route and diagnose the defect;
- **environment/tool failure** — required runtime, network, dependency, credential, or external service is unavailable → record the blocker or resolve the actual capability/environment gap;
- **human-owned decision/authorization** — product truth, credential, cost, destructive/production/publication/install approval, legal/rights decision, or another human gate is unresolved → surface the concrete question and stop only the covered action;
- **execution-continuity failure** — the agent can perform the work, but bounded frontier/todo/evidence/gate/wait/handoff state is not surviving reliably enough across turns/sessions, or unchanged waits/retries keep causing useless model calls → treat `execution-continuity` as a capability gap.

Only the last class justifies considering a long-running execution-control provider.

When current evidence proves an `execution-continuity` gap:

1. load `../capability-planning/SKILL.md` and describe the exact missing property;
2. prove host-native AAOP Working Contract/Journey plus project-native state is insufficient for that property;
3. load `../provider-selection/SKILL.md`;
4. prefer the smallest matching provider surface rather than adding a generic agent runtime;
5. if LoopX is selected, load `../../recipes/loopx.json` and `../../../docs/LOOPX_INTEGRATION.md` when available;
6. keep adoption conditional on the current upstream revision, OS/runtime support, permissions, privacy, rollback, and the real pilot/verification boundary in that Recipe.

Do **not** select LoopX merely because:

- the task is large;
- the user asked for autonomy;
- an implementation failed twice;
- a model needs more reasoning context;
- a Task Pod needs specialist roles;
- a deployment is blocked on credentials/authorization;
- LoopX happens to be installed.

If LoopX is selected, the authority seam is fixed:

```text
AAOP Working Contract / Route / Journey / authorization / acceptance
        ↓ derives one bounded execution outcome
LoopX todo / claim / gate / evidence / quota / wait / scheduler / handoff
        ↓ drives bounded turns
host Agent + project tools
        ↓ produces real evidence
LoopX validated writeback
        ↓ compact accepted evidence/reference only
AAOP coordinator re-reads current project evidence and checkpoints/reroutes
```

The LoopX goal/frontier is **not** a second Journey and does not become product truth. LoopX quota eligibility is not permission for protected effects. Specialists or LoopX peer agents do not become independent Journey checkpoint writers.

Do not create a parallel `.aaop` Execution Ledger that mirrors LoopX todo/quota/run-history state. If a real LoopX pilot later proves an AAOP-specific continuity fact is missing, add only that smallest AAOP-owned fact after the gap is demonstrated.

If the execution-control provider does not close the original continuity gap, diagnose why before adding Deep Agents, agency-orchestrator, or another provider. Provider stacking without distinct proven gaps is another form of anti-thrash.

## Gate 5 — Specialist capability only when justified

Default to one capable agent.

Only split responsibility when specialization, context isolation, safe parallel independence, adversarial review, or a permission boundary materially improves execution.

Before adding a specialist:

1. check the main agent's native ability;
2. check repository scripts/libraries/tests;
3. check existing Skills and host tools;
4. check already connected tools/providers;
5. identify the exact missing specialization.

Load `../team-construction/SKILL.md` when a real responsibility split is justified. AAOP owns Task Pod composition, one accountable owner, responsibility boundaries, acceptance, and handoff.

If the Task Pod still has a concrete specialist-role gap after host-native and project-local roles are checked, `agency-agents-zh` may be selected as a **direct optional role source** for the minimum justified role subset. Role prompts do not create missing APIs, tools, credentials, network access, or runtime capabilities and do not become project/product authority.

If the justified Task Pod instead lacks delegated multi-role DAG/resume execution that the current host cannot provide, evaluate `agency-orchestrator` as a **separate runtime capability**. A role source and an execution runtime are different gaps; do not install both without separate evidence.

`agent-bundles` is retired for new AAOP work. Its Provider/Recipe entry is only a compatibility tombstone for older installed instructions and must redirect to current Task Pod/provider policy rather than cloning or installing the old repository.

Specialist workers do not become independent Journey-state owners; checkpoint updates remain serialized through the primary orchestration context and protected by the current revision precondition.

## Gate 6 — Release-candidate proof

Do not equate “tests passed” with “ready for the accepted target.”

Before entering consequential release/delivery execution, establish a release candidate with evidence appropriate to the actual deliverable, such as:

- the intended acceptance path works;
- relevant regression tests pass;
- build/type/lint gates pass where configured;
- CI or another approved executable-gate state is known;
- verification harnesses and acceptance oracles are trustworthy enough for the claims they support;
- checks claiming implementation/runtime behavior actually observe the authoritative implementation/runtime target;
- no unintended diff or exposed secret is present;
- final artifact/install/profile capability closure is known when the deliverable crosses an artifact boundary;
- configuration requirements are identified;
- migrations/data changes are understood when applicable;
- observability/health/consumer checks are sufficient for the real target and blast radius;
- rollback/uninstall/restore/recovery path exists before consequential writes;
- material verification debt required for acceptance is retired;
- when third-party reuse/redistribution is part of the release, outbound LICENSE/NOTICE/terms status is known rather than inferred from public visibility.

Thresholds such as fixed coverage percentages are project policy, not universal AAOP law. Use the project's own risk and acceptance baseline.

This gate absorbs the durable lessons from `solo-dev-autopilot` release preflight while removing application/deployment-specific hard-coded thresholds.

## Gate 7 — Release authorization and target operation

Enter `release-operations` when release/delivery/target acceptance is the current problem.

First recover the actual deliverable, intended consumer, and real target. Do not assume `production server` merely because the repository contains a Web app, demo, development server, or deployment file.

Before a consequential target write:

- identify the exact target/consumer environment or destination;
- obtain direct target/artifact/runtime evidence where possible;
- know the current target revision/resource/artifact precondition;
- verify the authorized access path;
- define rollback/uninstall/restore appropriate to the target;
- revalidate the material target precondition immediately before the write;
- stop and reconcile if the target moved;
- require user authorization for consequential production/publication/install/legal actions unless an already-established policy explicitly grants that authority.

When the final artifact claims a capability, source-tree success is not enough. Prove that required files, entrypoints, runtime dependencies, configuration, and declared external prerequisites survive the artifact boundary; where material, validate from a clean built/installed target.

When third-party reuse/redistribution is part of the accepted outcome, public visibility is access evidence only. Inspect current LICENSE/NOTICE/terms and relevant bundled third-party obligations. If the intended grant is unknown, keep that release slice blocked and ask only for the material owner/legal/product decision; do not auto-select MIT, Apache, GPL, proprietary, or another license.

Never bypass missing credentials, network restrictions, external dependency outages, authorization, rights decisions, artifact closure, or monetary boundaries by installing alternate providers or widening access.

Historical source: this preserves the core safety boundary from `solo-dev-autopilot` deploy-gate while using AAOP's risk-based autonomy policy rather than a separate permission system.

## Gate 8 — Observe the actual target outcome

A deployment, publication, package build, zip creation, installation, or file copy event is not the finish line.

Verify the **actual deliverable** against the intended consumer/target using the strongest practical direct evidence for the **current release cycle**.

Examples of target evidence include, only when applicable:

- deployed service: version/revision identity, health/readiness, representative user path, logs/error signals, browser smoke, migration/data result;
- Skill/plugin: exact artifact identity, clean supported host discovery/load, representative task behavior, uninstall/recovery status;
- library/package: exact released artifact, clean consumer install/import/use, compatibility/behavior evidence;
- CLI: exact installed artifact and representative installed-command behavior;
- infrastructure/configuration: exact applied state plus target-specific validation and rollback evidence.

These are examples, not a mandatory taxonomy. The project-defined observable target decides what proof is required.

Local Git state, source-tree tests, CI success, a built artifact that has not been consumed, or target evidence from a previous release cycle cannot substitute for current-cycle evidence from the real target.

If direct target evidence is unavailable, preserve target state as unknown, checkpoint the exact blocker, and keep the Journey **blocked/not-complete**. Do not convert “unknown but probably fine” into a completed release, and do not invent an unrelated Web deployment just to satisfy the Journey.

If failure thresholds are crossed, execute the prepared target-appropriate reversal when authorized, then reroute using the observed failure.

The Journey checkpoint may be marked `complete` only after direct current-cycle target verification; `.aaop/tools/journey.py` enforces this invariant.

## Gate 9 — Learning loop and next release cycle

A completed release cycle becomes immutable historical evidence. If real use or a new product decision creates more build/fix work, **do not mutate the completed cycle and do not reuse its target verification**.

Re-read the current checkpoint and use its latest revision when opening the next release cycle:

```bash
python .aaop/tools/journey.py status idea-to-production --json
python .aaop/tools/journey.py checkpoint idea-to-production \
  --expected-revision <revision-from-latest-status> \
  --start-next-cycle \
  --gate <current-gate> \
  --route <current-route> \
  --reason "<why a new release cycle exists>" \
  --evidence "<current evidence that creates the new delta>"
```

Starting the next cycle:

- archives the completed cycle's outcome and target evidence into `release_history`;
- increments the cycle number;
- resets current-cycle `target_verified` and `target_evidence`;
- keeps the long-horizon product goal and route history;
- requires the new current gate/route to be selected from present evidence;
- fails instead of overwriting concurrent Journey changes when the expected revision is stale.

After a real use, release, failure, or near-miss:

- preserve the new evidence;
- distinguish product learning from engineering learning;
- promote a Pressure Guard only when the failure pattern is repeatable and route-relevant;
- update the next outcome rather than expanding process for its own sake.

The old `creating-forward` repository is historical lineage for requirement baseline, task/evidence discipline, authorization boundaries, and interruption recovery. Its interruption-recovery lesson is represented here by a persisted but non-authoritative Journey checkpoint. It remains archived and should not be installed as a second protocol beside AAOP.

## Beginner-facing interaction contract

The user should usually see:

- what we are trying to make true now;
- what was learned or changed;
- whether it is verified;
- what genuinely blocks progress;
- the one material decision/authorization they actually own, if any.

The user should **not** be asked to operate:

- route names;
- Journey checkpoint, revision, or release-cycle mechanics;
- Agent counts;
- Skill selection;
- MCP/provider selection;
- branch choreography;
- CI mechanics;
- framework/database choice;
- packaging/install/deployment mechanics that can be derived and executed by the system;
- release checklists that can be derived and executed by the system.

A novice is the product owner of intent, not the scheduler of the engineering machine.

## Completion criterion

The end-to-end Journey is complete for the **current release cycle** only when:

- the real deliverable reaches the intended consumer/target established from current project evidence; deployment is required only when deployment is actually part of that target;
- the exact target revision/state/artifact is directly verified with current-cycle evidence appropriate to that target;
- the intended consumer/acceptance path is proven in the target context where practical;
- artifact capability closure is proven when the accepted deliverable crosses a material package/image/zip/install/plugin/Skill or similar boundary;
- rollback/uninstall/restore/recovery status appropriate to the actual target is known;
- material verification debt required by the acceptance contract is retired;
- outbound rights/terms are known when third-party reuse/redistribution is part of the accepted outcome;
- material residual risks are visible;
- and the next product decision can be made from real evidence rather than speculative architecture.

A safely blocked Journey is a correct execution state, but it is **not complete**. If direct target verification cannot be obtained, record the blocker and exact unblock condition and stop short of completion after reconciling and exhausting the remaining genuinely independent executable frontier.
