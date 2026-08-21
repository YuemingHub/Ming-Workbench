# Pre-Mutation Reconciliation Policy

Status: normative cross-route policy for existing-project mutation.

## Purpose

AAOP must not execute quickly against an untrusted picture of the project.

Before the first material mutation of an **existing** project or deployed resource, establish that the baseline used to compute the change is trustworthy enough for that change. This is a cross-route invariant, not a project-specific onboarding flow, not a new workflow engine, and not a mandatory snapshot document.

The policy applies when `bug-fix`, `feature-change`, `repo-recovery`, or `release-operations` will mutate existing code, configuration, tests, documentation, data, deployment state, or another existing resource.

## Minimum reconciliation surface

Reconcile only the facts that can change the immediate route, delta, write target, acceptance evidence, or risk boundary:

1. **Active work target** — repository/resource plus current branch/ref/environment/destination when material.
2. **Requested outcome** — what observable state the current work is trying to make true.
3. **Current baseline** — implementation/runtime/deployment state relevant to the change.
4. **Evidence authority and freshness** — which sources own which claims and whether they are current, historical, draft/reference, or unknown.
5. **Material contradictions** — disagreements among code, tests, state/handoff documents, runtime evidence, adapters, CI, deployment records, specs, or historical artifacts.
6. **Acceptance baseline** — which tests/checks/reviews currently prove the desired behavior and which evidence becomes stale if its governing assumption changed.
7. **Unknowns** — facts that cannot be established from available evidence and therefore must remain unknown.

Do not inventory the whole repository merely to satisfy this policy. Stop when the immediate mutation decision is defensible.

## Evidence rules

- A test is evidence about an expected behavior; it is not automatically the highest authority for product identity, current deployment state, user state, policy, or another external fact.
- A failing test may prove a product defect, a test defect, a stale assertion, an environment mismatch, or an unresolved contract conflict. Classify before fixing.
- A state/status/handoff file may be authoritative for some claims and stale for others. Respect project-declared scope and freshness.
- Current code proves what is implemented, not necessarily what is intended.
- Runtime/target facts require runtime/target evidence when they materially affect the decision.
- Historical PRs, branches, comments, old names, cached adapters, generated bridges, and prior AI conclusions remain historical/reference evidence until reconciled.
- `unknown` is a first-class state. Do not silently convert unknown into `false`, absent, disabled, unused, non-production, or any other negative assertion.
- Newest timestamp, default branch, merged status, or most detailed document does not automatically win an authority conflict.

## Effective critical-control enforcement

A project may declare authentication, authorization, safety, privacy, consent, isolation, rate/budget, destructive-action, or another critical control in documentation, configuration, UI, tests, helper functions, middleware, policies, or generated plans.

The **presence** of that control is not evidence that the protected operation is actually governed by it. When a material current claim depends on a critical control being effective, verify the smallest representative active path from entrypoint to control decision and protected action before treating the claim as true.

Check, where relevant, that:

1. a representative protected entrypoint actually reaches the intended control before the protected action or data becomes available;
2. deny/unauthorized/unsafe input is rejected on the authoritative enforcement side rather than only hidden or discouraged in client/UI code;
3. allow/authorized input reaches the intended operation without relying on a different shadow path;
4. error, timeout, missing dependency, malformed state, or fallback behavior does not silently fail open when the contract requires fail-closed behavior;
5. alternate routes, direct APIs, background jobs, generated calls, or other materially equivalent entrypoints do not bypass the declared control;
6. tests or runtime probes exercise enforcement at the boundary that owns the decision, not merely the existence of a guard function, config key, button, redirect, or policy document.

Scale this check to consequence and declared contract. AAOP does not mandate authentication, rate limiting, privacy gates, or any specific control for every project. It requires **effective-path evidence only when the project or current outcome claims such a control is material**.

If a declared material control exists but is unreachable, client-only, bypassed, or fail-open on the active path, classify the protection claim as false/defective rather than green. If active-path evidence cannot currently be obtained, keep the control status unknown and scope the blocker; do not infer protection from the control's mere presence.

## Verification harness integrity

A project may have a custom test runner, CI wrapper, validation aggregator, generated report, coverage collector, smoke-test dispatcher, model-based evaluator, or similar **verification harness** that turns many underlying checks into one pass/fail or readiness claim.

That aggregate result is evidence only if the harness is trustworthy enough for the decision that relies on it. When a custom or consequential harness is the main acceptance source, inspect the smallest material integrity surface before promoting a green aggregate into completion, release, or regression proof.

Check, where relevant, that:

1. intended checks are actually discovered and executed rather than silently omitted by path, naming, filter, cache, import/module identity, or configuration errors;
2. distinct checks cannot collide, alias, or reuse stale loaded state merely because they share a basename, identifier, cache key, or generated target;
3. skipped, errored, timed-out, cancelled, unavailable, credential-blocked, or dry-run checks are represented honestly rather than counted as pass or no-op;
4. failure exit codes and failure states propagate through wrappers, matrices, `continue-on-error` behavior, pipelines, and report generators;
5. counts/summaries do not double-count one execution or hide missing expected executions;
6. when practical, a representative known failing condition or direct underlying check demonstrates that the aggregate harness would fail rather than remain falsely green;
7. when acceptance depends on generated or nondeterministic output, the acceptance oracle is independent and explicit enough for the claim: criteria are fixed before the observed output where practical, generator self-assessment is not silently promoted into independent verification, and material model/runtime/version assumptions are recorded when they can change the result;
8. when a check claims implementation or runtime behavior, the observed **actual** value has a causal path from the authoritative implementation/runtime surface being claimed. A mirror constant, copied decision function, fixture-only self-comparison, `actual = expected`, or another shadow implementation proves only that the local test/spec representation is self-consistent unless it is explicitly scoped as such;
9. when consequence or evidence concentration is material, use at least one representative mutation-sensitive path: a relevant change in the owning implementation should be capable of changing or failing the check without first editing the test's mirrored implementation. If that dependency cannot be shown, narrow the claim or keep implementation verification provisional.

Do not require a meta-test framework for every ordinary project command. Scale this check to consequence and evidence concentration: a standard mature runner with direct project tests may need no special audit, while a bespoke aggregator that is the sole basis for a safety, release, or completion claim needs stronger proof.

A model, agent, or generator saying that its own output passes the criteria can be useful diagnostic evidence, but it is weaker than an independent evaluator, deterministic assertion, calibrated rubric, or other external acceptance signal. Do not treat same-turn self-judgment as independent proof merely because it returns structured `PASS`/`FAIL` JSON.

A shadow implementation or mirrored constant can still be useful as a specification/reference check, fixture validator, or contract example. Its evidence scope must stay honest: it does not become implementation/runtime proof merely because it executes successfully or lives under a test directory.

If harness integrity, evaluator validity, or evidence-target fidelity is materially unknown or disproven, downgrade the affected green result to provisional/unknown evidence. Prefer direct underlying checks where practical, repair the harness when it owns the defect, and re-establish only the affected acceptance evidence. Do not change product behavior merely to satisfy an unsound verification harness.

## Verification debt containment

A scoped verification blocker must not be promoted into project-wide paralysis, but autonomous continuation also must not turn an **unverified mutation** into the trusted baseline for an indefinitely growing chain of dependent changes.

When a material delta has been implemented but the evidence required to verify it is unavailable, cost-gated, environment-blocked, credential-blocked, or otherwise still unknown:

1. keep the delta's acceptance state explicitly **unverified/unknown**; implementation presence, code review, static plausibility, or an earlier non-exact candidate check does not make the current head verified;
2. record the affected surface and the missing evidence capability/precondition at the smallest useful scope;
3. treat a later delta that depends on that unverified surface as inheriting the unresolved verification debt; do not silently use the unverified head as a fully trusted baseline;
4. continue genuinely independent authorized frontier whose correctness does not depend on the blocked evidence, including static authority repair, documentation that reflects known facts, independent components, or capability-resolution work;
5. keep the dependent unverified chain **bounded**. As consequence, shared-surface coupling, number of dependent mutations, or failure-localization cost grows, prioritize restoring the missing verification capability or split/reduce the candidate instead of stacking more dependent mutations merely to remain busy;
6. critical-control, migration, release, deployment, shared-runtime, and other high-consequence surfaces require a stricter bound: do not keep compounding dependent unverified mutations when a representative executable check is unavailable;
7. before merge, release, deployment, stable promotion, or project-completion claims, retire all material verification debt required by the acceptance contract on the exact candidate/baseline being accepted.

A verification blocker therefore has **dependency-aware scope**: it does not automatically stop unrelated work, but it propagates to later work whose validity depends on the unverified delta. This preserves both sides of AAOP autonomy: do not stop too early, and do not create a large opaque candidate that can only be debugged after many unverified assumptions have accumulated.

Monetary cost remains an authorization boundary. If the preferred verification path would incur unauthorized cost, seek an already-available local, project-native, self-hosted, or otherwise authorized equivalent first. If no equivalent is currently available, keep the required evidence unknown and contain the affected verification debt; do not spend by default and do not lower the acceptance standard to compensate.

## Derived control surface truth boundary

A project may contain local orchestration/readiness scripts, CI helpers, release-status commands, generated bridges, dashboards, Agent bootstrap files, or other **derived control surfaces** that summarize project or operational state for automation.

These surfaces are allowed to calculate, aggregate, validate, or present project facts. They must not silently become a second source of truth for claims already owned elsewhere.

When a derived control surface makes a material claim:

1. resolve the project-defined source that owns that claim, or keep the value `unknown` when the source cannot establish it;
2. derive from current source/runtime evidence rather than copying a historical literal into the adapter;
3. preserve enough provenance/source linkage that a future maintainer or Agent can identify where the claim came from;
4. do not convert missing input into a convenient negative assertion;
5. when the owning contract changes, treat dependent adapter/test/readiness evidence as stale and re-establish it on the new baseline;
6. when recurrence risk is material, prefer a consumer-local regression that proves the adapter still derives from current authority and preserves unknown semantics.

This does **not** require every project to create a readiness adapter, state file, or conformance test. The rule applies only when such a derived control surface exists and its output can affect route, release, safety, or mutation decisions.

## Mutation gate

Before the first material mutation, classify the reconciled result:

- **trusted-current-delta** — enough current evidence agrees on the baseline and a real authorized delta exists; continue in the owning route.
- **stale-derived-evidence** — current authoritative evidence is sufficient, but a derived test/adapter/report/assertion still encodes an old assumption; update only the stale derived surface and re-establish affected evidence.
- **material-conflict** — sources disagree and authority/freshness do not justify a winner; preserve the conflict and use `repo-recovery` or a human-owned decision when required.
- **unknown-blocker** — a fact required to execute safely cannot currently be established; keep it unknown and block only the affected action.
- **verified-no-op** — the requested state already holds or no current mutation is justified.

Do not change current product behavior merely to satisfy stale derived evidence. Do not rewrite historical sources merely to make the repository look internally consistent.

## Relationship to route execution

This policy strengthens the existing AAOP execution-delta gate:

```text
request / continuation
  -> inspect current evidence
  -> reconcile material authority + freshness
  -> classify contradictions / unknowns / stale derived evidence
  -> prove current execution delta
  -> mutate the explicit authorized target
  -> revalidate write precondition
  -> verify on the new baseline
```

For a tiny, obvious edit in a trustworthy project, reconciliation may be a few reads and one current test. For a contradictory long-running project, it may require `repo-recovery`. The amount of process scales with uncertainty and risk, not repository size.

## Project independence

AAOP Core must not encode product names, organization names, domain actors, fixed status filenames, brand strings, deployment conventions, or project-specific state fields in this policy.

A project may declare its own authoritative sources, status vocabulary, adapters, and invariants. AAOP consumes those declarations as evidence; it does not replace them with a universal product schema.

Real consumer projects should feed anonymized/public pressure cases back into AAOP only when a failure pattern generalizes across projects.
