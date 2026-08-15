# Ming Workbench Architecture — v0.0.1

## Product boundary

Ming Workbench is the human-facing work layer. It is not another agent runtime.

```text
Human intent
    ↓
Ming Workbench
  Space · Work Unit · Gate · Evidence · Asset · Outcome
    ↓
Domain Pack
  development → AAOP
    ↓
DeepSeek Harness
  Agent · Tools · Skills · MCP · Presets · Subagents · Workflow · Jobs
    ↓
real systems and evidence
```

For software development, AAOP owns the control protocol. DeepSeek Harness owns the selected execution surface. LoopX is optional and only closes a proven durable cross-session execution-continuity gap.

## First invariant

A Work Unit cannot be considered completed only because an agent says it is done.

Completion requires:

1. no open gate;
2. at least one acceptance criterion;
3. every acceptance criterion satisfied;
4. every satisfied criterion references recorded evidence.

`assertCompletionInvariant()` enforces this in the first core model.

## Developer Intake before mutation admission

A normal user should be able to state an outcome without naming implementation files. Discovering the correct file surface is often part of grounded AAOP Developer Intake.

Therefore current repository-frontier evidence has two different roles:

### During Developer Intake

It is **context**, not an execution authorization gate.

```text
intended file surface unknown
→ AAOP may continue read-only intake and inspect the project

known surface overlaps active work
→ AAOP may narrow, reroute, wait for handoff, or choose another slice

known surface appears non-overlapping
→ useful evidence, but still not durable execution authority
```

Even a safe-looking intake-time frontier may become stale while reasoning continues.

### Immediately before mutation

Workbench requires fresh active-work evidence and the exact intended file surface:

```text
fresh file surface unknown
→ scope-required → no mutation

fresh surface overlaps active work
→ conflict → no mutation

fresh surface is proven non-overlapping
→ frontier gate passes
→ AAOP may issue/consume the bounded write execution grant
```

This separation preserves both goals: ordinary-language intake for the human and fail-closed repository concurrency for execution.

## Authority map

### Ming Workbench owns

- human-facing Spaces and Work Units;
- current Work Unit state;
- gates surfaced to the human;
- evidence references and produced assets;
- the human-facing outcome view.

### A Domain Pack owns

Domain-specific interpretation and control semantics. The first pack is `development-aaop`.

### AAOP owns for software development

- Human-Agent Working Contract;
- grounded Developer Intake and current software-development Route;
- decision ownership;
- Task Pod responsibility;
- provider selection;
- authorization boundaries;
- Provider Execution Grant;
- final engineering acceptance and rerouting.

Workbench must not duplicate these state machines.

Provider Execution Grant correlation follows the same ownership boundary. The AAOP grant remains an exact consumer view of AAOP's closed canonical schema. Workbench correlates `grant_id` to its own `WorkUnit.id` through a separate Workbench-owned binding. It may preserve a human-readable Work Unit pointer in the grant's existing generic `references` list when useful for traceability, but it must not add `work_unit_ref`, `space_id`, or other Workbench product fields to the AAOP grant itself.

### DeepSeek Harness owns

The selected execution surface:

- model adapters;
- tools and MCP;
- Skills;
- Sessions;
- Agent Presets;
- subagents;
- workflows;
- jobs;
- approval and permission UI;
- Web UI extension seams.

Harness completion is execution evidence, not final project truth.

### LoopX may own

Only a proven durable execution-continuity gap that remains after Harness + AAOP are pressure-tested. It is not part of the default stack.

## Compatibility and distribution policy

DeepSeek Harness is in developer preview. The first reviewed source snapshot is:

- source package metadata: `@deepseek-ai/dsh@0.1.0-rc.5`
- commit: `47f943859bef60e4160492346772ded9b24f765a`
- reviewed: `2026-08-14`

The authoritative Workbench pin is `harness.lock.json`.

The first GitHub CI run intentionally tested the assumed npm path and failed with `ETARGET`: the source-reported `0.1.0-rc.5` was not installable from npm at that observation point. Workbench therefore does not declare Harness as an npm dependency yet.

Current rule:

```text
Workbench core dependencies
≠ Harness runtime distribution

Harness runtime
= external source checkout at reviewed exact commit
```

`npm run doctor:harness` verifies the configured checkout's source package version and exact Git SHA.

All upstream-specific version/capability decisions belong under `src/hosts/` and `harness.lock.json` rather than domain logic.

Do not deep-fork Harness merely to brand Ming Workbench. Prefer its documented plugin, profile, bundle, patch, preset, and UI-slot extension seams.

## Current executable chain

```text
ordinary-language goal
→ Work Unit
→ read-only AAOP Developer Intake
→ proposed exact mutation scope
→ fresh repository-frontier execution gate
→ AAOP Provider Execution Grant
→ Workbench-owned Work Unit ↔ grant binding
→ disposable isolation clone (git clone --no-local @ granted base ref)
→ guarded Harness ACP execution INSIDE the isolation only
→ isolated delta + MutationSlice verification (realpath-verified)
→ tests/evidence inside the isolation
→ violation → discard isolation, real repo untouched
→ authorized + verified delta applied back to the real repo
→ authoritative real repository readback
→ AAOP engineering acceptance
→ evidence-backed Work Unit completion
```

The real repository is never the Harness mutation target. A bounded run mutates a
fully independent disposable clone detached at the granted base ref; its git
metadata (refs / HEAD / config / tags / index) is physically separate from the
real repository, and only the authorized and verified delta is ever written back
(see `src/execution/execution-isolation.ts`).

Family Space remains the first real proving ground, but Workbench must respect its current active PR ownership before selecting any mutation slice.
