---
name: developer-intake
description: Convert a developer's minimal natural-language request into the correct AAOP development route before capability/provider selection. Use for vague ideas, continuation requests, messy repositories, bug reports, feature requests, code understanding/review, or release/operations work. Ask only when one missing fact would materially change the route or outcome.
---

# Developer Intake

This is the front door of AAOP.

The user should not need to know the route names, Agent types, Skills, MCP servers, runtimes, or orchestration model. Accept ordinary developer language such as:

- “I have an idea but I don't know how to build it.”
- “Continue.” / “Keep going.” / “What should we do next?”
- “This repo is a mess; understand it and keep going.”
- “Login returns 500. Fix it.”
- “Add family invitations.”
- “Review this PR/repo and tell me what matters.”
- “Get this ready to deploy.”

## Principle

First understand **the user's situation and desired observable outcome**. Then route. Do not make the user classify their own task or design the technical solution unless they explicitly want to.

Routing is not keyword matching. Consider together:

1. **Asset state** — idea only, current workspace, repository reference, snippets/files, or deployed system.
2. **Situation** — greenfield, recovery, bug, feature, understanding/review, or release/operations.
3. **Desired outcome** — what should be true when the work is done.
4. **Evidence** — repository, tests, failures, logs, issues/specs, runtime/deployment context, and an existing Journey checkpoint when present.
5. **Risk** — whether the first meaningful action is local/reversible or externally consequential.
6. **Solution vocabulary status** — whether named technologies are hard constraints, preferences, or merely hypotheses the user is exploring.

## Default autonomous takeover request

Treat ordinary requests such as "AAOP: take over this project", "I do not know where
this project is; you are responsible", or "continue development" as a delegation of
the ordinary engineering loop, not as a request for a route name, roadmap, or a
read-only repository summary. If the request or an authoritative Working Contract
clearly selects autonomous delivery, persist/reuse that preference without asking a
second collaboration-mode question.

### Control-plane source freshness before takeover

An installed AAOP package can be internally healthy while still being an old control
plane. Before a non-trivial autonomous takeover trusts local `health`, `ready`, route,
no-op, blocker, continuation, or completion semantics, inspect the installed source
policy when bootstrap provenance is available.

For a `stable-managed` installation, run:

```bash
python .aaop/tools/source_freshness.py --json
```

Interpret the result as execution evidence:

- `current` — continue with the installed stable control plane;
- `stale` — this is a proven control-plane compatibility delta. Reuse the canonical
  state-preserving **stable bootstrap**, preserve `.aaop/runtime` and project-owned
  rules/state, re-run project compatibility/readiness evidence, then re-read the
  current AAOP intake/Journey rules before selecting the project frontier;
- `unknown` — do not infer freshness from the local version or health result. Keep the
  network/source-evidence limitation explicit and scoped; continue independent safe
  authorized project work that does not depend on the missing control-plane claim;
- `frozen` / `explicit-ref` / `not-managed` — preserve the explicit source policy.
  Do not silently replace an exact/pinned/local source with `stable` or `main` merely
  because upstream moved.

Source freshness is not product truth and does not grant production, credential, cost,
or project mutation authority. Do not build another updater: the existing canonical
bootstrap remains the only package lifecycle path.

Start from current evidence and reconstruct two separate things:

1. **Ultimate intent**: why the project exists and the observable long-horizon outcome.
   Prefer authoritative product/governance material; use current implementation,
   tests, CI/deployment evidence, recent history, issues, and PRs as supporting
   evidence. Preserve material conflicts rather than converting stale artifacts into
   intent.
2. **Current development goal**: the highest-value evidence-backed result AAOP can
   advance now. It is normally selected by the agent from the current baseline, not
   supplied by a novice.

If intent can be reconstructed only as a bounded hypothesis, advance a reversible
evidence-bearing slice. Ask one question only when an unresolved product/domain value
fork would materially define the product and cannot be resolved from evidence or a
safe experiment. Do not treat technical uncertainty, an unfamiliar repository, failing
tests, architecture choice, provider choice, or an incomplete plan as a human-owned
question.

When useful, materialize `.aaop/runtime/intake-envelope.json` against `../../schemas/intake-envelope.schema.json`.

## Step 1 — Read before asking

If a workspace, repo URL, issue, file, logs, or other accessible evidence is already available, inspect enough of it to resolve the situation before asking the user to restate what the environment can answer.

Do not ask “What stack is this?” when manifests can answer.
Do not ask “What error do you see?” when the supplied logs show it.
Do not ask the user to summarize a repository you can inspect.

### Existing Journey checkpoint is continuity evidence

Before treating a terse continuation request as a brand-new intake, check whether this project already has:

```text
.aaop/runtime/journeys/idea-to-production.json
```

When it exists, inspect it through:

```bash
python .aaop/tools/journey.py status idea-to-production --json
```

Then load `../end-to-end-delivery/SKILL.md` and reconcile the checkpoint against current repository/runtime/target evidence **before** choosing the next action.

This is especially important when the user says only:

- “continue”;
- “keep going”;
- “resume”;
- “what next?”;
- “continue this project”;
- or another underspecified continuation phrase.

The checkpoint proves that a prior long-horizon Journey exists. It does **not** prove that its saved route, blocker, or next action is still current truth.

Handle checkpoint status explicitly:

- `active` — preserve the long-horizon goal, reconcile current evidence, then choose the current Route. Do not restart product discovery merely because the new conversation is short.
- `blocked` — first re-check the recorded unblock condition against current evidence. If it is unchanged, do not blindly retry the same failed action, widen permissions, or install a provider to bypass the blocker. Keep it blocked unless independent authorized work can genuinely advance the same outcome.
- `complete` — the completed release cycle is immutable historical evidence. A vague “continue” does not authorize invented features or a new release cycle. Start the next cycle only when fresh user/product/runtime evidence creates a real new delta, using the explicit next-cycle contract from `end-to-end-delivery`.

If `journey.py status ...` fails, **do not interpret the failure as “there is no Journey.”** Preserve the checkpoint file and follow the state-reader boundary:

- malformed/current-schema corruption with an available last-good snapshot → use `python .aaop/tools/journey.py recover idea-to-production` only through a trusted matching/newer AAOP tool; recovery preserves the damaged file and advances the revision, then the recovered checkpoint must still be reconciled against current repository/runtime/target evidence before mutation;
- future/unsupported checkpoint schema → do **not** run old recovery, edit the JSON, delete the checkpoint, or start a replacement Journey. Use a matching/newer trusted AAOP state reader first;
- no safe recovery snapshot → preserve the damaged checkpoint as evidence and stop continuity mutation until it can be reconciled manually or with a compatible tool.

A recovery command is not a way to roll back valid but inconvenient state. The current checkpoint must actually be missing/invalid; a valid current checkpoint continues through ordinary reconciliation + revision CAS.

If the checkpoint is stale relative to the installed Journey definition or contradicted by current project evidence, preserve the conflict and reconcile it; do not silently overwrite or ignore it.

## Step 2 — Infer the primary route

Read `../../registries/routes.json`.

Choose one primary route:

- `idea-to-build`
- `repo-recovery`
- `bug-fix`
- `feature-change`
- `understand-review`
- `release-operations`

### Priority rules for mixed requests

Choose the route that unlocks the user's most immediate outcome.

Examples:

- “This repo is messy and checkout is broken; fix checkout first” → `bug-fix`, queue recovery/cleanup.
- “Understand this old repo and then continue development” → `repo-recovery`.
- “Review this repo and if the architecture is sound add X” → `understand-review` first if the review gates the feature decision; otherwise `feature-change` with an inspection phase.
- “Add X and deploy it” → `feature-change` first; queue `release-operations` unless deployment is already the blocking task.
- “Continue” with an active Journey checkpoint → reconcile the saved goal and current evidence first; choose the current Route from that evidence instead of inventing a new goal.

Do not create parallel routes merely because the sentence contains multiple verbs.

### Broad end-to-end goals use the Journey, not a new route

If the user's desired outcome explicitly spans multiple route transitions — for example “I have an idea; take it all the way to a real app and get it online” — load `../end-to-end-delivery/SKILL.md` in addition to this intake Skill.

Also load the Journey when an existing checkpoint proves that the current project is already inside that long-horizon goal, even if the user's new message is only a terse continuation request.

The Journey preserves continuity across the existing routes; it does not replace route selection. Still choose exactly one **current** primary route from the list above, then reroute only when evidence changes the immediate problem.

## Step 3 — Translate language into an observable outcome

Do not treat the literal wording as the complete specification.

Convert it into a provisional statement of success.

Examples:

- “Make it better” → identify which current pain/decision defines better.
- “Fix login” → user can complete the login path that currently fails; the observed failure no longer reproduces and regression evidence passes.
- “Add invitation” → identify who can invite whom, the visible workflow, and the smallest acceptance path.
- “Continue this project” → reconcile any active Journey/current project state, find the highest-leverage next blocker or delta, and improve it with evidence.

### Early technical vocabulary is not automatically a requirement

For greenfield requests, classify named technology before using it:

- **hard constraint** — the user explicitly requires it for compatibility, policy, contract, existing ecosystem, or another concrete reason;
- **preference** — useful to honor when it does not conflict with the outcome;
- **solution hypothesis** — a technology name proposed before the need is evidenced.

If a user says “use agents, MCP, RAG, memory, a vector DB, and graph orchestration,” do not silently turn all of those terms into architecture requirements. First identify the user-visible workflow and what capability each term would need to supply.

If the outcome can be safely inferred from project evidence and the request, proceed.

### Choose the current goal without making the user schedule

For an autonomous takeover, choose one current goal after baseline and intent
reconstruction. Prefer, in order of present evidence: a safety/production blocker; a
broken acceptance path; a proven incomplete core journey; a current defect; an accepted
project milestone; or a reliability gap that prevents the next meaningful outcome. Do
not create speculative cleanup or a broad roadmap merely to have a next task.

When project authority declares a current release candidate, active PR/candidate stack,
predecessor/successor order, current handoff, or another current-work surface that can
change the goal, treat that topology as bounded execution evidence. Compare its unmet
acceptance/review/executable gates with the accepted product outcome. Do **not** infer
that every open issue/branch/PR is current, and do not treat green checks on the present
checkout as proof that the delegated project has no other current frontier.

After each verified delta, re-read the relevant current evidence and make the same
selection again. Continue while a safe, authorized, evidence-backed next delta exists;
reroute when evidence says the delta belongs elsewhere. A route-level verified no-op is
not permission to declare the long-horizon project complete.

## Step 4 — Ask only a route-changing or outcome-blocking question

Ask at most one intake question at a time, and only when the answer could materially change:

- the primary route;
- the user-visible outcome;
- a major product choice;
- whether a proposed technology is actually a hard constraint;
- or the safety/permission class of the next action.

Good intake questions are concrete:

- “Which user should be able to invite whom?”
- “Is the failure in production or only local?”
- “Which of these two behaviors do you want to preserve?”
- “For the first version, what is the one task a user must be able to complete?”

Avoid process questions:

- “Do you want analysis or implementation?” when the request already says “fix”.
- “Should I continue?”
- “Do you want me to inspect the repo?”
- “Which agent team should I use?”
- “Which database/framework should I choose?” when the system can derive it later.
- “What were we doing?” when an existing Journey checkpoint and project evidence can recover the answer.

If a reversible experiment can resolve the ambiguity, prefer the experiment over asking.

## Step 5 — Preserve review boundaries

When the request is primarily “review / assess / tell me whether we should …”, the default route is read-only `understand-review` unless the user explicitly authorizes implementation.

Do not convert a review finding into a patch, PR, configuration change, issue update, or upstream mutation merely because the fix looks obvious. The review should first support the decision the user actually asked to make.

## Step 6 — Set route confidence

Use a practical confidence estimate:

- `0.85–1.0`: route and outcome are clear enough to start.
- `0.65–0.84`: route is clear; some details can be learned during discovery.
- `<0.65`: ask one high-leverage question only if inspection cannot resolve it.

Confidence does not need to be shown to the user unless useful; it exists to prevent ceremonial clarification.

## Step 7 — Hand off, don't over-orchestrate

After routing:

- `idea-to-build` → outcome discovery → first evidence-bearing slice → minimal architecture → real evaluation.
- `repo-recovery` → project discovery/recovery before broad implementation.
- `bug-fix` → reconcile baseline → reproduce/evidence → localize → minimal fix → regression verification.
- `feature-change` → behavior contract → impact discovery → implementation → acceptance/regression verification.
- `understand-review` → decision-oriented inspection; current evidence; no mutation by default.
- `release-operations` → environment/runtime evidence + blocker classification + rollback + autonomy policy before consequential action.

For a broad end-to-end goal or an existing Journey checkpoint, the loaded `end-to-end-delivery` Skill keeps the user's original product outcome active while the current route changes. Do not ask the user to re-specify the full journey at every transition.

Only after the route exposes a real capability gap should AAOP run provider selection.

## Step 8 — Keep the interaction natural

Do not announce internal machinery unless it helps the user.

Prefer:

> “I found the failing login path and I'm tracing it from the API boundary before changing code.”

Not:

> “I classified you into Route bug-fix with confidence 0.93 and spawned the debugging capability.”

The route is an internal coordination mechanism, not a form the user must operate.

## Completion criterion

Developer intake is complete when:

- the current situation is sufficiently understood;
- stable-managed control-plane freshness has been checked when material, or its source/network uncertainty is explicitly scoped without being mistaken for current compatibility;
- any relevant existing Journey checkpoint has been read/recovered/reconciled rather than ignored or restarted;
- materially current project work topology that can change the current goal has been bounded/reconciled rather than replaced by the checked-out branch alone;
- one primary route is selected;
- a provisional observable outcome is defined;
- proposed solution vocabulary is not being mistaken for requirements without evidence;
- review/mutation boundaries are explicit where relevant;
- only material unknowns remain;
- and work can move into the route-specific discovery/execution loop without making the user manage orchestration.
