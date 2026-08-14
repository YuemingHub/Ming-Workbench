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
- current software-development Route;
- decision ownership;
- Task Pod responsibility;
- provider selection;
- authorization boundaries;
- final engineering acceptance and rerouting.

Workbench must not duplicate these state machines.

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

## Compatibility policy

DeepSeek Harness is in developer preview. The first reviewed snapshot is:

- package: `@deepseek-ai/dsh@0.1.0-rc.5`
- commit: `47f943859bef60e4160492346772ded9b24f765a`
- reviewed: `2026-08-14`

All upstream-specific version/capability decisions belong under `src/hosts/` rather than domain logic.

Do not deep-fork Harness merely to brand Ming Workbench. Prefer its documented plugin, profile, bundle, patch, preset, and UI-slot extension seams.

## Next executable slice

Wire one real development Space to one real repository and prove one Work Unit end-to-end:

```text
ordinary-language goal
→ Work Unit
→ AAOP Route / decision ownership / authorization
→ Harness execution
→ repository + test/runtime readback
→ evidence-backed completion
```

The first pilot should use Family Space because it is a real active product, not a toy repository.
