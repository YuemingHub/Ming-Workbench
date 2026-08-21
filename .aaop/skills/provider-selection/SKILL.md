---
name: provider-selection
description: Select the smallest sufficient external standard, runtime, execution control plane, discovery service, or workspace only after a concrete capability gap is proven. Use when AAOP must decide whether to stay host-native or add Agent Skills, MCP, LoopX, Deep Agents, a delegated multi-agent runtime, or another provider.
---

# Provider Selection

Use this Skill after project discovery and capability matching reveal a real gap.

## Principle

Do not ask which framework is globally best. Select the provider that closes the current gap with the smallest justified operational surface.

A provider is never permanently “safe”, “unsafe”, “approved”, or “rejected” merely because an AAOP Recipe contains a prior review. Provider status, implementation, deployment context, and mitigations can change.

## Step 1 — Prove the gap

Record:

- required capability;
- evidence the current host/project cannot satisfy it adequately;
- whether the gap is one-off or recurring;
- required reliability/durability/governance level;
- when multiple providers are involved, the **material composition seam** that must actually close between them.

Before declaring a new capability missing, distinguish these cases:

- endpoint capability is truly absent;
- endpoint capabilities exist, but their required artifact/state/identity/authorization cannot cross the provider seam;
- execution is possible but continuity across turns/sessions is unreliable;
- a non-technical blocker such as authorization, network policy, cost, or legal/product truth is preventing the action.

A broken composition seam is not evidence that the endpoint capabilities themselves are missing.

For work expected to span many turns, sessions, agents, or external waits, explicitly ask whether the missing capability is **execution continuity/control** rather than implementation ability. A useful local capability label is `execution-continuity`:

- preserve one bounded executable frontier across sessions;
- know when another model turn should run versus wait/gate/quiet;
- keep todo ownership, evidence and handoff durable;
- resume from state plus current project evidence rather than transcript memory.

Do **not** declare `execution-continuity` missing merely because a task is large. First prove the current host/Journey/Working Contract cannot continue it reliably enough.

If no gap is proven, select **no additional provider**.

## Step 2 — Prefer progressive enhancement

Check in order:

1. current host native capability;
2. current project scripts/libraries;
3. an existing Agent Skill;
4. an existing connected MCP/tool;
5. an already-authorized shared workspace, artifact handoff, mount, export/import, or other bridge that closes a proven composition seam;
6. one new Skill or MCP;
7. ARD/A2A discovery/interoperability when provider identity is unknown or cross-system communication is needed;
8. one specialized runtime or execution-control provider when runtime/control properties are the actual gap;
9. an organizational workspace only when shared governance is the actual gap.

Read `../../registries/providers.json` and `../../../docs/PROGRESSIVE_ADOPTION.md` when available.

### Composition closure before provider escalation

When the required capability path spans providers, evaluate the path as a graph rather than a bag of tools.

For every material edge, establish:

- the object transferred (repository revision, package, file, structured result, credential-scoped reference, etc.);
- the producer-side identity/version/digest when material;
- the receiving provider's actual access path;
- provenance/metadata the downstream step needs;
- authorization/data-egress constraints;
- evidence that the downstream consumer used the same accepted object rather than a stale/reconstructed approximation.

If repository provider A can read exact commit `H` and execution provider B can run code, but no authorized path can place `H` or an identity-preserving artifact from `H` into B, then **exact-head execution remains partial**. Do not call disconnected endpoint availability a complete execution capability.

Prefer the smallest seam repair. A large runtime/control plane is justified only when the missing seam is genuinely part of the property it supplies.

## Step 3 — Separate discovery from installation

Discovery may use:

- current host catalogs;
- ARD-compatible discovery services;
- Official MCP Registry;
- A2A Agent Cards;
- first-party provider documentation.

A discovered candidate is not automatically trusted or installed.

Before external installation or connection evaluate:

- provenance and publisher;
- maintenance/activity;
- permissions and write scope;
- credentials/secrets;
- data egress;
- infrastructure burden;
- cost;
- lock-in and uninstall path;
- overlap with existing providers;
- whether it actually closes the proven endpoint or composition gap rather than merely adding another disconnected capability.

Apply `../../policies/mcp-and-tools.md` and `../../policies/autonomy.md`.

## Step 4 — Select by symptom

Use these as heuristics, not hard-coded routing:

- Missing repeatable procedure → **Agent Skill**.
- Missing external service access → **native tool or MCP**.
- Two needed capabilities exist but cannot exchange the required exact artifact/state under current authorization → **smallest compatible bridge/shared workspace/provider-native transfer**, or one provider that closes that seam; do not automatically add an orchestration runtime.
- Unknown resource/provider across catalogs → **ARD-compatible discovery**.
- Independent opaque agents must communicate → **A2A**.
- Existing host can perform the engineering work, but durable cross-turn/session todo/evidence/gate/quota/wake/handoff control is the missing property → consider **LoopX** or another execution-control provider.
- The agent runtime itself is inadequate for long-horizon reasoning/execution, context isolation, persistence, filesystem/Skills/MCP-heavy work → consider **Deep Agents** or another dedicated agent runtime.
- A justified AAOP Task Pod specifically needs bounded multi-role DAG/resume execution that the current host cannot supply → consider **agency-orchestrator** or another delegated multi-agent runtime; AAOP remains the Pod/Journey/Working Contract authority.
- Typed production workflows/hosting are the gap → consider **Microsoft Agent Framework**.
- Dynamic workforce composition is the gap → consider **CAMEL Workforce**.
- Automatic creation/testing of new tools, agents, workflows is itself the desired capability → consider **AutoAgent**.
- Persistent multi-human/multi-agent governance, approvals, audit, scheduling and runtime routing are the gap → consider **AgentSpace** or another mature organizational workspace.

### Do not collapse these gaps

| Proven gap | Preferred provider family | AAOP boundary |
| --- | --- | --- |
| Required endpoint capabilities exist but cannot exchange the accepted artifact/state with required identity/authorization | smallest transfer bridge/shared workspace or one provider that natively closes the seam | AAOP keeps the capability graph, acceptance identity and authorization boundary; the bridge only transfers the required object |
| The current agent can do the work, but the loop cannot reliably decide/resume/hand off across turns | LoopX-style execution control plane | AAOP keeps intent, Route/Journey, authorization and acceptance; provider governs bounded execution continuity |
| The current agent runtime itself lacks the long-horizon execution/context/persistence mechanics needed to do the work | Deep Agents-style agent runtime | AAOP delegates the bounded Route/Pod execution but keeps product/authorization/release authority |
| A justified Task Pod needs explicit multi-role DAG/resume execution | agency-orchestrator-style delegated Pod runtime | AAOP defines the Pod outcome, members, gates, acceptance and handoff; provider executes the bounded Pod |

Do not install two of these merely because the task is long or the current tools are inconvenient. Choose the smallest provider whose **primary mechanism** matches the proven gap. If one provider fails to close the gap, diagnose the mismatch before stacking another control plane/runtime on top.

## Step 5 — Resolve the integration recipe

If `.aaop/recipes/<provider-id>.json` exists, use it as the normalized integration contract.

A recipe centralizes:

- selection/avoid conditions;
- detection hints;
- smallest known upstream installation path;
- credentials and permissions;
- optional scoped `adoption_review` debt;
- verification;
- rollback;
- `source_of_truth` and `last_verified`.

Before executing any external installation, re-check the recipe's `source_of_truth` when network access is available. Upstream installation instructions override stale recipe commands.

### Adoption review rule

If the recipe contains `adoption_review`, treat it as **remembered review debt**, not a verdict.

Before consequential adoption of a surface that falls within the recorded `scope`:

1. read `reviewed_at`, `reason`, `current_observations`, `sources`, and `required_checks`;
2. re-check the current upstream source/release/issue/advisory state when accessible;
3. determine whether the intended provider mode/surface actually uses the reviewed mechanism;
4. evaluate the real deployment context, permissions, data exposure, network reachability, and mitigations relevant to the recorded concern;
5. update the decision based on current evidence, not the stale observation alone.

Interpret `decision_effect` as:

- `informational` — include the review in the decision but it does not require a special adoption gate by itself;
- `reverify-before-adoption` — re-check the scoped concern before enabling the relevant surface;
- `conditional-adoption-only` — use the relevant surface only when the recorded/current conditions or mitigations can be explicitly satisfied.

If the concern has been fixed upstream or is irrelevant to the selected surface/context, it should not block adoption. Update or retire the stale review when maintaining the Recipe.

If the concern remains materially relevant and cannot be mitigated within the user's authorization/risk boundary, prefer:

- a narrower surface of the same provider;
- an isolated deployment;
- another provider that closes the same gap with lower operational exposure;
- or no new provider yet.

Do not bypass or suppress a relevant adoption review merely to keep an earlier provider choice.

If no recipe exists, create an **ephemeral integration plan** from first-party documentation instead of guessing. Promote it to a reusable recipe only after it is validated and likely to recur.

The recipe browser is available at:

```bash
python .aaop/tools/recipe.py list
python .aaop/tools/recipe.py show <provider-id>
```

These commands never install providers.

## Step 6 — Produce a minimal integration plan

Return or materialize:

```yaml
capability_gap: <what is missing>
gap_class: <endpoint | composition-transfer | execution-continuity | runtime | team-execution | governance | blocker>
current_level: <0-5>
selected_providers: [<provider-id>]
selected_surface: <smallest provider surface actually needed>
authority_owner: <which AAOP/project state remains authoritative>
composition_edge: <none | producer -> required object -> consumer>
identity_or_provenance_required: <none | exact revision/digest/metadata requirement>
why_now: <evidence-backed reason>
why_not_simpler: <why lower layers are insufficient>
why_not_adjacent_provider: <why a runtime/control-plane/workspace alternative is the wrong primary mechanism>
adoption_review: <none | rechecked current finding/condition>
permissions_required: []
credentials_required: []
infrastructure_required: []
expected_benefit: <measurable improvement>
verification: <how to prove the original endpoint/composition gap closed>
rollback: <how to remove/disable it>
```

Do not propose a bundle of unrelated technologies.

For a provider that stores execution/control state, explicitly state which facts remain authoritative in AAOP/project state and which facts the provider may own. Never allow two systems to become silent competing sources of truth for the same decision class.

For a transfer/composition provider, explicitly state which object it transfers and which identity/provenance/authorization facts it must preserve. The bridge does not become product truth merely because it can move bytes.

## Step 7 — Verify after integration

After adding a provider or bridge, verify the original capability gap is actually closed.

When an adoption review applies, also verify that the actual installed/enabled surface matches the assumptions or mitigations used in the adoption decision.

For a composition gap, verification must execute or consume the **same accepted object** across the seam and prove material revision/digest/provenance continuity. “Both tools are connected” is not composition closure.

For execution-control/runtime providers, verification must include at least one behavior that the host previously could not prove reliably: restart/resume, no-progress quieting, durable handoff, independent validation/writeback, or another gap-specific property. “Installed successfully” is not gap closure.

If the capability gap is not closed, diagnose before adding another provider. Multiple failed additions are evidence the problem may be misunderstood rather than under-tooled.

## Completion criterion

Provider selection is complete when either:

- no external addition is needed; or
- exactly the justified provider/bridge set is selected, the current upstream integration path is known, every material composition edge required by the accepted execution path is explicitly closed or blocked, the authority seam is explicit, any applicable adoption review has been rechecked against the intended surface/context, permission/cost implications are explicit, and the original gap has a concrete verification/rollback plan.
