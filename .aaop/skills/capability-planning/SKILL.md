---
name: capability-planning
description: Convert a user outcome and project profile into required capabilities, dependencies, acceptance evidence, and a capability matrix before choosing agents. Use for multi-step work, unfamiliar tasks, or whenever the right team/tools are not obvious.
license: Apache-2.0
---

# Capability Planning

## Goal

Describe what must be possible to achieve the outcome before deciding who should do it.

## Workflow

1. Write the `stated_request` and the best-grounded `underlying_outcome`.
2. List concrete deliverables/state changes.
3. Identify hard constraints and decision boundaries.
4. Define acceptance evidence before implementation.
5. Decompose the outcome into **capabilities**, not job titles. Prefer verb/noun ability labels such as `repository-analysis`, `browser-validation`, `data-migration`, `security-review`.
6. For work expected to span many turns, sessions, agent contexts, or external waits, decide whether `execution-continuity` is a real capability requirement. Use that label only when the project needs one or more of:
   - a bounded executable frontier that survives fresh sessions;
   - durable todo ownership/evidence/handoff rather than transcript memory;
   - an explicit run/wait/gate/quiet decision before another model turn;
   - scheduler/monitor wake semantics for external waits;
   - recovery from interruption without reopening already-resolved human-owned questions.
   A large task does **not** automatically require this capability. First inspect whether the current host plus AAOP Working Contract/Journey already provides sufficient continuity.
7. Add dependencies between capabilities. Mark which can run independently.
8. For each capability, inspect providers in this order:
   - main agent native ability;
   - available Skill;
   - native host tool;
   - connected MCP/app;
   - repository script/test harness;
   - existing specialist/subagent;
   - existing runtime/control-plane capability already installed and authorized;
   - missing.
9. Mark provider fit as `available`, `partial`, `missing`, or `blocked`.
10. **Close the composition path, not only the capability list.** Whenever one capability/provider must hand an artifact, repository state, identifier, credential-scoped reference, result, or other material input to another capability/provider, verify that the handoff actually exists and preserves the properties required by acceptance. At minimum ask:
    - what exact object crosses the seam;
    - how its identity/version/digest is preserved when material;
    - whether metadata/provenance needed by the consumer survives;
    - whether the receiving provider can actually access the object in its execution environment;
    - whether authorization/data-sensitivity boundaries survive the transfer;
    - what evidence proves the object consumed downstream is the same accepted object produced upstream.
11. For missing/partial capabilities **or broken composition edges**, state the smallest gap that must be resolved. Do not choose a new MCP/runtime/control plane yet unless resolution truly requires one.

## Capability composability and transfer closure

A bag of individually available tools is not yet an execution system.

Treat a required provider-to-provider seam as part of the capability contract whenever the output of one capability must become an input to another. The end-to-end capability remains `partial` when both endpoint capabilities exist but the required artifact cannot cross the seam with sufficient identity, provenance, access, or authorization.

Example:

```text
repository provider can read exact branch H
+
execution provider can run Python
+
no authorized repository/artifact transfer path between them
=
exact-head repository execution is still partial/missing
```

Do not silently reconstruct selected files in another environment and call that **exact-head** verification. Reconstruction may be useful scoped evidence, but exact-head evidence requires revision continuity from the evidence/source owner to the execution target. When artifact identity is material, prefer immutable revision/digest/provenance evidence over names such as `latest`, `main`, `stable`, an unverified filename, or a copied directory with unknown origin.

Prefer the smallest closure:

1. reuse an already-authorized shared workspace/mount/artifact reference;
2. use an existing provider-native export/import or immutable artifact handoff;
3. add the smallest bridge that preserves required identity and authorization;
4. select one provider that natively closes the proven seam if that is materially simpler/safer;
5. add a broader runtime/control plane only when the missing property actually requires it.

Do not install an orchestration framework merely because two existing tools cannot exchange one artifact. First prove the exact seam that is missing.

When serializing a capability matrix, use `composition_edges` to record material inter-capability handoffs. Only material edges need to be modeled; do not turn every in-process function call into orchestration metadata.

## Execution-continuity boundary

Keep these separate when planning:

- **implementation capability** — can an Agent actually edit, reason, test, or operate the project?
- **capability composability** — can the required providers exchange the exact artifacts/state/identity/authorization needed to form the end-to-end execution path?
- **execution-continuity capability** — can bounded work continue safely across turns/sessions/waits with durable evidence and stop conditions?
- **team-execution capability** — does a justified Task Pod need explicit parallel/dependency/resume machinery?
- **organizational governance capability** — do multiple humans/runtimes need shared approvals, audit, permissions, and ownership?

A weakness in one class is not evidence to install a provider aimed at another class.

Examples:

- Repository access and local execution both exist, but the exact candidate cannot cross into the execution workspace → composability/transfer gap, not an execution-continuity gap.
- Agent can code/test but repeatedly wakes with stale context and no durable wait/no-progress state → `execution-continuity` gap.
- Current host cannot sustain the long-horizon reasoning/tool runtime itself → runtime gap, not merely continuity.
- One bounded Pod needs explicit multi-role dependency execution → team-execution gap.
- Several people/agents require shared audit/approval/routing → governance gap.

Provider choice belongs to `provider-selection`; capability planning only proves which class is actually missing.

## Output

Use `.aaop/schemas/capability-matrix.schema.json` when serializing.

A useful matrix answers:

- What capability is required?
- Why is it required?
- What existing provider can satisfy it?
- What is missing?
- What does it depend on?
- Which material composition edges must close between providers/capabilities?
- What artifact/state crosses each material edge, and what identity/authorization must survive?
- What evidence will later prove it worked?

For `execution-continuity`, acceptance evidence should name the actual property to prove, for example:

- fresh-session resume reconstructs the same bounded frontier;
- unchanged external wait causes no unnecessary model turn;
- repeated unchanged failure becomes a durable blocker/quiet state;
- handoff preserves compact evidence and responsibility;
- validation failure cannot be recorded as successful completion.

For a material composition edge, acceptance evidence should name the transfer property, for example:

- execution workspace consumed commit SHA `H`, not a reconstructed approximation;
- downloaded package digest equals the producer's accepted artifact digest;
- receiving provider can resolve the artifact without widening permissions;
- transfer preserves required metadata/provenance and does not leak sensitive data.

Do not use “LoopX is installed”, “the scheduler ran”, “GitHub access exists”, or “Python can execute” as evidence that a different end-to-end capability has closed. Installation and endpoint availability are not the composed outcome.

## Anti-patterns

Do not:

- produce “PM / frontend / backend / QA” simply from habit;
- map every capability to a different agent;
- add external tools when a local/native capability is sufficient;
- confuse a Skill with permission to access an external system;
- declare a composed capability available because its endpoint verbs exist on disconnected providers;
- call reconstructed/copied source exact-head evidence without revision continuity;
- continue planning around a provider that the current host cannot actually use;
- declare `execution-continuity` missing only because the task is long;
- collapse runtime ability, capability composability, continuity control, Task Pod execution, and organizational governance into one vague “need orchestration” gap.

## Completion condition

Planning is sufficient when every required capability has either:

1. an available provider **and every material composition edge needed to use it in the accepted path is closed**;
2. a concrete low-risk gap-resolution path; or
3. an explicit blocker that requires user action.

For any proposed external runtime/control-plane escalation, the matrix must identify the exact missing capability class, any broken material composition seam, and evidence proving lower layers are insufficient before provider selection begins.
