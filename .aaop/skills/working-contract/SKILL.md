---
name: working-contract
description: Establish and maintain the Human-Agent Working Contract before sustained autonomous or collaborative execution. Resolve evidence first, persist the user's collaboration mode and aligned intent, classify decision ownership, and gate autonomous execution while human-owned questions remain.
license: Apache-2.0
---

# Human-Agent Working Contract

## Purpose

This Skill is the interaction contract above AAOP Routes. It answers four questions before sustained execution:

1. What is the human actually trying to make true?
2. How does the human want to collaborate: autonomous delivery or collaborative delivery?
3. Which remaining decisions belong to the human, the agent, or both?
4. Is the intent aligned enough to enter an execution loop without ceremonial interruption?

It is **not** a questionnaire, PRD workflow, or replacement for project discovery. The contract is continuity state; current evidence and explicit user instructions remain authoritative.

## Startup

For any non-trivial implementation/continuation request, inspect:

```bash
python .aaop/tools/working_contract.py status --json
```

If the contract is uninitialized, initialize it with the known long-horizon goal:

```bash
python .aaop/tools/working_contract.py init --goal "<known goal>" --json
```

Do not silently choose `autonomous` or `collaborative` for the human when no established preference exists. Ask one concrete collaboration question once, then persist the answer with `set-mode`.

If the user has already clearly selected a mode in the current or authoritative project context, persist that choice without asking again.

An explicit takeover request such as "AAOP: take over this project", "you are
responsible for development", or "I do not know where the project is; continue it"
selects the `autonomous` preference when it also delegates ordinary engineering work.
It does not grant credentials, cost, production, destructive, or other consequential
authority beyond AAOP policy.

## Collaboration modes

### `autonomous`

After alignment is confirmed, continue ordinary reversible engineering work without asking “continue?” or asking the human to choose technical machinery. Stop/ask only for:

- a genuinely human-owned product/domain choice;
- new credentials, secret-bearing authorization, or external account connection;
- new material cost;
- a high-impact/irreversible action outside established authorization;
- an unresolved blocker after evidence-driven diagnosis;
- final acceptance/production approval where project policy requires it.

### `collaborative`

The agent still owns engineering execution, but surfaces material product/architecture tradeoffs at meaningful checkpoints. Do not turn collaborative mode into approval for every file edit, test, dependency, or implementation detail.

## Alignment loop

Alignment is **evidence resolution plus only necessary human clarification**.

First inspect what the environment can answer:

- project instructions and authority sources;
- manifests and code;
- tests/CI;
- git history, issues and PRs;
- architecture/product docs;
- deployment/runtime evidence;
- existing Journey checkpoint and prior Working Contract.

Classify unknowns:

1. **Evidence-resolvable** — inspect; do not ask the human.
2. **Expert-decidable** — agent/CTO decides from constraints, reversibility, cost and project fit; record when material.
3. **Human-owned** — ask because the answer defines product/domain/business intent or grants authority.

Ask at most one human-owned question at a time. Do not use human questions to outsource framework, database, Agent count, Skill, MCP, provider, test framework, or branch choreography.

Persist the aligned shape through `update-alignment`:

- `goal` — long-horizon purpose;
- `actor` — who experiences the outcome;
- `situation` — when/where the outcome matters;
- `outcome` — observable improvement;
- `must` — essential invariants;
- `non_goals` — explicit exclusions for this cycle;
- `constraints` — genuine hard boundaries/evidence decisions;
- `success_evidence` — how completion will be proven;
- `human_open_questions` — only unresolved human-owned decisions.

## Alignment gate

Do not mark alignment complete merely because discussion has become long.

`confirm-alignment` must fail unless:

- collaboration mode is confirmed;
- goal, actor, situation and observable outcome are present;
- at least one success-evidence item exists;
- no human-owned open question remains.

Before entering sustained implementation, run:

```bash
python .aaop/tools/working_contract.py gate --json
```

`execution_allowed=true` means the **interaction contract** permits the execution loop. It does not override AAOP autonomy/security/production policy, missing credentials, Journey blockers, or repository-specific rules.

If aligned intent materially changes, use `reset-alignment --reason <evidence>` and re-align. Do not silently rewrite an already confirmed contract.

## Decision ownership

Use the persisted defaults as a baseline, refined by explicit project/user policy.

### Human-owned by default

- product intent and value tradeoffs;
- domain truth unavailable from evidence;
- audience/business-model boundaries;
- credentials or secret-bearing authorization;
- new monetary commitments.

### Agent-owned by default

- technical architecture inside established constraints;
- framework/database/tool choice when not a hard user constraint;
- implementation details/code organization;
- test strategy and ordinary verification;
- Task Pod size/role selection/provider choice within AAOP policy.

Ordinary technical uncertainty is agent-owned. An unfamiliar codebase, a missing
current-goal plan, test failure, architecture or tool choice, implementation design,
and ordinary debugging/verification must be resolved from evidence or reversible
experiments rather than escalated to a novice as a product question.

### Joint by default

- material irreversible product behavior;
- major safety/ethics/privacy/legal boundaries;
- high-impact production/destructive changes not already authorized.

Risk policy still applies. A decision may be agent-owned conceptually but require human authorization for the resulting external action.

## Task Pod relationship

After alignment, default to one capable agent. Load `../team-construction/SKILL.md` only when specialization, isolation, independent review, permission boundaries, or safe parallelism creates measurable value.

A Task Pod:

- has 1–5 members, never more;
- has exactly one accountable owner;
- assigns responsibilities, not honorary job titles;
- has objective acceptance criteria;
- dissolves after its bounded outcome is accepted;
- hands off through `.aaop/schemas/task-handoff.schema.json` before a materially different next Pod takes over.

Role libraries such as `agency-agents-zh` are optional specialist sources. They do not create missing tool/API/runtime capability and must not become a second orchestration control plane.

## Continuity

The Working Contract and Journey checkpoint serve different purposes:

- Working Contract = human/agent collaboration + aligned intent + decision boundary;
- Journey checkpoint = long-horizon route/gate/evidence/release-cycle continuity.

On continuation, reconcile both against current project/runtime evidence. Neither saved file outranks fresher authoritative evidence.

## Completion criterion

Working-contract intake is complete when:

- the collaboration mode is known and persisted;
- project evidence has answered everything it can answer;
- agent-owned technical choices are not being outsourced to the human;
- all remaining human-owned questions are resolved;
- observable success evidence is explicit;
- `working_contract.py gate` allows execution;
- the current Route/Journey can proceed under ordinary AAOP autonomy policy.
