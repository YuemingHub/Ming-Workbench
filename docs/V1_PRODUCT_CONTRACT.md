# V1 Product Contract — Human-First Entry

> **Authority.** This document is the authoritative product contract for Ming
> Workbench V1's first user-facing loop. Where README, AGENTS, or the
> Constitution describe pre-confirmation product shape, this contract wins for
> the V1 entry experience. Reuse Before Build and the Constitution remain the
> durable engineering law.

## 1. V1 first user

A person with real-world intent, judgment, and responsibility who has **no**
requirement of a repository, PRD, GitHub, AAOP, Harness, or software-engineering
knowledge. They may arrive with one of three states:

- a concrete idea they can describe;
- only a vague feeling or half-thought;
- nothing yet — they do not yet know what they want to work on.

The product must make all three states walkable.

## 2. The one loop

```text
first letter
→ 开始
→ one of three human entry choices
→ multi-turn conversation
→ grounded understanding
→ larger direction/map
→ one smallest complete real outcome
→ optional simple preview
→ round agreement
→ human confirmation
```

**The loop STOPS at confirmation.** This long-run round performs no AAOP/Harness
execution and no mutation. Confirmation is a product boundary, not a handoff to
an execution engine.

## 3. UX sequence

1. Fresh userData / no project opens a **human-facing letter** — never a project
   picker and never an engineering console.
2. The letter ends with one action: **开始**.
3. After 开始, exactly three entry choices:
   1. `我已经有一个想法`
   2. `我只有一点模糊念头`
   3. `我现在也不知道想做什么`
4. **Conversation is the main surface.** The Workbench clarifies progressively,
   never as a questionnaire. It reflects only strengths/resources the person
   actually said — no invented context.
5. Before confirmation the Workbench shows:
   - `我理解的你想去的地方`
   - `你已经带来的东西`
   - `我们可以怎么一步步走到那里`
   - `我建议先做到这一件事`
6. The recommendation is exactly **one smallest complete real outcome** — a
   thing a normal person can see and use — never an engineering component.
7. Round Agreement communicates four required semantics:
   - `这一轮会得到什么`
   - `它解决什么问题`
   - `你会在哪里看到 / 怎么使用它`
   - `这一轮明确不做什么`
8. The person confirms (e.g. `对，就是这个，开始吧`). The confirmation is
   persisted and the product STOPS there.

## 4. Human vs Workbench decisions

**Human owns:** reality, values, what they actually want to become true, which
entry describes them, and the final confirmation.

**Workbench owns:** clarifying questions, grounding the conversation into what
was actually said, structuring a path, recommending one smallest complete real
outcome, and writing the round agreement in human language.

Workbench must never silently replace human intent with a convenient technical
proxy.

## 5. Mandatory human gates

- **开始** — entering the loop.
- **entry choice** — one of the three.
- **confirmation** — accepting the round agreement.

No execution, mutation, repository, or external write of any kind happens before
confirmation.

## 6. Normal UI boundary

Pre-confirmation normal UI is **human language only**. The following are hidden
from normal pre-confirmation UI:

```text
Git  repo  AAOP  Harness  Agent  MCP  provider  model  API key
Work Unit  branch  CI  terminal  npm  node  pipeline  PR
```

Engineering diagnostics, if present at all, live behind an explicitly collapsed
"更多信息" affordance that a normal person never needs to open.

## 7. One acceptance scenario

A deterministic installed Windows journey from **fresh userData and no existing
repo** must prove: letter appears; 开始 works; exactly three entries exist; an
ordinary-language idea is entered through the real UI; more than one
conversation turn; synthesis is grounded in the conversation; the larger
direction/map is human-facing (not a ticket UI); exactly one smallest complete
outcome is recommended; the agreement contains the four required semantics;
confirmation persists across close/reopen; no repo/project is required before
confirmation; normal pre-confirmation UI hides engineering concepts; no
execution or mutation occurs; and Stage 0 safety/runtime gates stay green. The
journey must **fail** if the old project-first welcome page returns.

## 8. Non-goals for this round

No general Stage 3 platform; the only post-confirmation execution surface is the
thin first-outcome bridge over the existing AAOP/Harness path, and it remains
behind the confirmation, provider, cost, and bounded-mutation gates. No Family
Space proving run; no multi-agent; no workflow/graph engine; no MCP platform; no
general memory/personality platform; no cloud/team/billing; no LoopX/PTC
expansion; no second runtime, Harness, AAOP, or Git layer; no tag/release/signing
work.

## 9. Reuse Before Build

Human-first V1 reuses existing provider and storage primitives. It adds the thin
pre-repo **Idea Space** needed to persist conversation, desired reality, larger
direction, one recommended outcome, round agreement, and confirmation, plus a
thin confirmed-to-first-outcome bridge that reuses AAOP, Harness, Git isolation,
and verification. It does not build a new workflow, runtime, or state-machine
platform.

## 10. First later real proving ground

The first real proving ground **after** this loop is a **new low-risk idea** —
a small, low-risk, real human intent executed and verified end-to-end. Family
Space is a proving ground only after such a low-risk real outcome round has
succeeded. Family Space is not the first step.
