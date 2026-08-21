---
name: route-execution
description: Execute a selected AAOP developer route by loading its Route Capability Pack, matching required capabilities against the current environment, and escalating to mature providers only for proven gaps. Use after developer-intake selects idea-to-build, repo-recovery, bug-fix, feature-change, understand-review, or release-operations.
---

# Route Execution

Use this Skill after `developer-intake` has selected one primary route.

## Principle

A Route Capability Pack is an **engineering capability map**, not a workflow engine, package bundle, or script that must be followed mechanically.

The route pack answers:

- what must become true in this development situation;
- which engineering capabilities are normally required;
- what evidence should move the work forward;
- which pressure-tested mistakes must not reappear;
- which mature providers may close specific gaps;
- when evidence means the route itself should change.

The developer should not operate the pack directly.

## Step 1 — Load exactly one current pack

Read `.aaop/routes/<route-id>.json`, where `<route-id>` is the current primary route.

Do not load all route packs unless comparison is genuinely needed.

Read any `pressure_guards` in the pack as route-level invariants derived from real project failures. They are not optional suggestions when the matching condition is present.

## Step 2 — Inventory before matching

When `.aaop/tools/doctor.py` is available, prefer a read-only inventory before guessing what the environment contains **when that inventory can change the current decision**:

```bash
python .aaop/tools/doctor.py . --route <route-id> --json
```

Treat the inventory as **presence evidence, not a recommendation or mandatory ceremony**. A detected provider can still be irrelevant; a non-detected provider can still be unnecessary.

For the current stage, map each `required_capabilities` entry against:

1. current host-native ability;
2. repository scripts/libraries/tests;
3. already-installed Skills;
4. already-connected tools/MCP/apps;
5. detected existing providers/runtimes;
6. specialist/subagent capability already available.

If the capability is already available, use it. A provider candidate in the route pack is **not** a default dependency.

## Step 3 — Work stage by stage, evidence first

For each applicable stage:

- understand its `purpose`;
- collect the smallest useful `evidence`;
- apply relevant `pressure_guards`;
- perform the work using current capabilities;
- stop the stage when `exit_when` is satisfied.

Do not manufacture documents merely because a stage exists. Evidence may be code, a failing test, runtime behavior, a decision, a short spec, a browser trace, a historical artifact classified by freshness/authority, or a validated deployment state.

A stage can become **not applicable** when evidence proves its intended mutation is unnecessary, belongs to another route/repository, or is outside current authorization. Do not execute a stage only to show activity.

## Step 4 — Prove the execution delta before mutation

Authorization to work is not proof that a change is necessary.

Before a material code/config/document mutation, compare the route's observable outcome with current evidence and classify the delta:

- `local-delta` — a current, evidence-backed difference exists in the active work target and the requested action class authorizes changing it;
- `verified-no-op` — the requested/route outcome is already true, or recovery shows no current local mutation is justified;
- `reroute` — the real delta exists but belongs to another route, repository, or action class;
- `blocked` — the delta may exist, but evidence, environment, authorization, credential, external dependency, or product decision prevents legitimate execution.

Rules:

1. `local-delta` → prepare the smallest coherent change.
2. `verified-no-op` → do not create a diff for appearances. Record the evidence that makes no mutation the correct result.
3. `reroute` → move the immediate outcome to the correct route; for another repository, preserve the cross-repository scope boundary and require separate mutation scope there.
4. `blocked` → classify the blocker precisely and state the smallest legitimate unblock.

For `repo-recovery`, perform this gate after current truth is reconstructed and **before** forcing the stabilization stage. Recovery may legitimately end with `verified-no-op` / `no-local-mutation-justified` when the repository is current and the next meaningful work is conditional, externally owned, or not yet supported by evidence.

Conversely, when recovery exposes a concrete local defect or desired behavior already supported by current project evidence, do not remain in analysis mode: stabilize it directly when still owned by `repo-recovery`, or reroute to `bug-fix` / `feature-change` and continue execution.

“Continue”, “fix it”, or broad implementation authorization gives permission within its risk/action class; it does not create an obligation to invent a change when no delta is proven.

Project-declared engineering gates still apply. Proving a delta does not authorize bypassing a repository's required planning, tests, review, or release process.

## Step 5 — Resolve target, then revalidate write preconditions

A proven delta can still be written to the wrong place. Before a consequential write, merge, deployment mutation, or remote update, first resolve the **exact destination**, then verify that the baseline/preconditions used to compute the delta still hold.

### 5.1 Resolve the explicit write target

For remote mutations, identify the exact repository/resource and target branch/ref/environment/destination from current project policy and task evidence.

Hard rules:

- If a host/tool API makes a branch/ref/environment/destination optional but omission causes a write to some default target, **do not rely on omission**. Pass the intended target explicitly.
- A repository's API default branch is metadata, not automatic authorization to write there.
- If the project says changes flow through a working branch + PR, create/resolve the working branch first and mutate that branch explicitly.
- Treat `main`, `master`, `production`, release branches, protected branches, or any project-designated merge/release target as consequential. Direct writes need the authorization/policy required by that repository; “continue”, “fix”, or general implementation authority does not silently bypass the branch/PR path.
- Re-check the destination immediately before the write. A correct file SHA on the wrong branch is still a wrong write.

Example:

```text
project policy: agent/* branch + PR
→ resolve current production head H
→ create/resolve agent/change from H
→ write with branch=agent/change + expected blob/ref precondition
→ verify agent/change changed and production did not
→ open PR
```

Do not do:

```text
project policy: agent/* branch + PR
→ update remote file with branch omitted
→ host silently writes default production branch
→ repair with a revert
```

### 5.2 Revalidate the baseline/precondition

Prefer the strongest native conditional-write mechanism available, for example:

- Git blob/content SHA for file updates;
- expected branch/PR head SHA or ref ancestry for merges/pushes;
- ETag / `If-Match`;
- resource version/generation;
- database row/version checks;
- lease/lock tokens;
- deployment revision/version preconditions.

If target + precondition hold, perform the authorized write and verify both the content/result **and the destination**.

If the precondition fails, target moved, or the write landed somewhere other than intended:

1. treat the condition as **new evidence**, not a nuisance retry;
2. stop additional consequential mutation on the ambiguous/wrong target;
3. do not automatically force, overwrite, reset, replay stale whole-file content, or keep using an implicit target;
4. re-read the intended target/baseline and identify concurrent changes;
5. if an unintended target changed, inspect and preserve that state; any revert/repair is itself a separate conditional write to an explicitly resolved destination;
6. recompute the intended change against the correct current baseline;
7. **re-run Step 4** because the delta may now be satisfied, smaller, conflicting, rerouted, or blocked;
8. re-check authorization/risk if the reconciled action materially changed;
9. retry against an explicit destination and conditional precondition only if the write remains justified;
10. verify the destination and result after the reconciled write.

A conditional-write or target-resolution failure is first a **baseline/target/concurrency problem**, not a `capability-gap` and not a reason to add another Provider or alternate write path.

`force` is a separate action class. Use it only when repository policy and user authorization make intentional replacement appropriate and the state being overwritten has been understood/preserved as required.

Apply `.aaop/policies/autonomy.md` for the full target-resolution and write-precondition contract.

## Step 6 — Classify blockers before declaring a capability gap

When work cannot proceed, diagnose the blocker before searching for another tool/framework.

Common blocker classes:

- `missing-evidence` — required evidence is not yet available or reproduced;
- `environment` — sandbox/network/OS/runtime constraints prevent the intended action;
- `authorization` — the action is outside granted scope or requires approval;
- `credential` — required secret/account/token is unavailable;
- `external-dependency` — an external service/system is down, unavailable, outside control, or must produce new evidence first;
- `product-decision` — two materially different product outcomes remain and repository evidence cannot choose;
- `capability-gap` — the action is authorized/reachable but the current execution system genuinely lacks a technical ability.

Only the last class directly justifies provider selection.

Do **not** respond to environment/authorization/credential/external/product/concurrency/target blockers by silently adding a runtime, VPN/tunnel, browser, MCP server, agent framework, alternate access path, or unrelated local change. Record the smallest unblock condition and preserve unknown state when evidence cannot be obtained.

## Step 7 — Prove a gap before escalation

Use an escalation only when its `when` condition is actually present, the blocker is truly a `capability-gap`, and the named `capability_gap` remains unresolved.

Then:

1. run provider selection;
2. inspect `.aaop/registries/providers.json`;
3. check environment inventory to avoid duplicating a provider already present;
4. load `.aaop/recipes/<provider-id>.json` when available;
5. re-check upstream source of truth before consequential installation;
6. choose the smallest provider surface that closes the gap;
7. apply autonomy/permission policy;
8. verify the original gap after integration.

If no provider is justified, keep using the current host.

## Step 8 — Prefer provider surfaces, not provider brands

When a provider exposes several surfaces, select only the one needed.

Examples:

- Playwright Test vs CLI+Skills vs MCP;
- OpenHands CLI vs SDK vs sandboxed/remote workspace;
- Spec Kit core flow vs one reviewed extension;
- one-time `uvx` evaluation vs persistent installation.

Do not install a provider's entire ecosystem to obtain one narrow capability.

## Step 9 — Treat community catalogs as discovery, not trust

Before adopting a community extension/plugin/bundle check source repository and publisher, maintenance, install scripts/hooks, filesystem/network/write permissions, credentials/data egress, and rollback/removal path.

Catalog presence alone is never sufficient authorization.

## Step 10 — Correct the route when evidence changes the situation

Evaluate `reroute_signals` after meaningful discoveries, after the execution-delta gate, and again if target/write-precondition revalidation changes the baseline.

Examples:

- feature request is actually a regression → `bug-fix`;
- bug cannot be localized because the repository is contradictory → `repo-recovery`;
- feature implementation is complete and deployment becomes the blocker → `release-operations`;
- review becomes an explicit implementation request → `feature-change` or `bug-fix`;
- repository recovery exposes a current local feature gap → `feature-change`;
- repository recovery shows the supposed next local change is already satisfied or not currently justified → verified no-op rather than invented work;
- concurrent work satisfies or invalidates the planned change → recompute/reroute instead of applying the stale patch;
- the intended mutation target differs from the actual/authorized target → resolve the target boundary before continuing; do not hide it as a route or capability problem.

Re-routing is progress, not failure. Keep queued secondary intents, but only one route should normally own the immediate outcome.

## Step 11 — Verify route completion

Use the pack's `verification` list as the final route-level evidence contract.

Also verify separately that any provider added during execution actually closed the capability gap that justified it.

A safely blocked task is not a successful outcome, but it can be a correct execution result when the route preserves unknown state, does not widen authorization, and identifies the precise minimal unblock.

A **verified no-op is a successful engineering result** when evidence proves the requested observable state already holds or no current mutation is justified. Do not call it a blocker and do not create a cosmetic diff to avoid reporting no-op.

Remove or disable unnecessary provider machinery when the task can return to a simpler layer.

## Completion criterion

Route execution is complete when:

- the current route's observable outcome is supported by evidence, the task is explicitly and safely blocked, or a verified no-op is the correct result;
- any material mutation was preceded by evidence of a real execution delta;
- any remote/consequential mutation used an explicitly resolved destination rather than relying on an optional host default when target identity matters;
- any consequential write used/revalidated the strongest practical baseline precondition and did not knowingly overwrite concurrent state without explicit authorization;
- default/protected/release/production branch policy was respected and direct writes were not inferred from generic implementation authorization;
- stale-write/precondition or wrong-target failures were reconciled by stopping, re-reading, re-proving the target/delta, and using a conditional explicit destination rather than force-retrying;
- material evidence freshness/authority and repository scope have been respected where relevant;
- required capabilities were satisfied with the smallest practical integration surface;
- existing environment capability was reused instead of duplicated;
- non-capability blockers were not disguised as reasons to install more machinery or invent unrelated work;
- any escalation was justified, verified, and reversible;
- route corrections were applied when evidence required them;
- project-declared engineering/release gates were preserved;
- the user did not have to manage the orchestration machinery.
