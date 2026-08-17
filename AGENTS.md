# AGENTS.md — Start Here

All coding agents, review agents, cloud agents, and local agents working in this repository must read this file **before making changes**.

Then read:

- `docs/WORKBENCH_CONSTITUTION.md`
- `docs/V1_PRODUCT_CONTRACT.md` (authoritative for the V1 human-first entry)
- the current repository state, branch, PR, tests, and evidence relevant to your task

The constitution is the durable product boundary. Current branch documents may be stale; repository reality wins for factual status.

---

## North Star

> **人负责理解现实，Ming Workbench 负责把值得发生的事情组织起来，让现成的最强 AI 能力去执行，并证明它真的发生了。**

Humans own reality, judgment, values, and responsibility.

Ming Workbench turns real intent into controlled execution, evidence, verification, and outcome.

The core loop is:

```text
Reality
→ Intent
→ Work Unit
→ Authority / Gate
→ Existing execution capability
→ Reality readback
→ Evidence
→ Verification
→ Outcome
→ Continuation
```

Do not reduce Ming Workbench to a coding agent, Harness GUI, AAOP GUI, Electron app, chat UI, or workflow engine.

---

## Hard Rule: Reuse Before Build

Before implementing any non-core infrastructure, first check:

1. this repository;
2. DeepSeek Harness;
3. AAOP / the current domain-control layer;
4. official ecosystem capabilities;
5. mature open-source projects on GitHub.

Preference order:

```text
Direct reuse
> thin adapter
> reuse mature design
> build the smallest missing layer
```

**No real gap evidence = no new infrastructure.**

Do not rebuild capabilities merely for control, uniformity, convenience, or future speculation.

Default forbidden duplicates include:

- agent loop;
- coding agent runtime;
- MCP runtime/protocol;
- tool runtime/protocol;
- subagent framework;
- workflow engine;
- goal engine;
- browser automation framework;
- Git implementation;
- provider/model runtime beyond thin product adapters;
- Harness session ledger;
- background-job engine;
- AAOP lifecycle/bootstrap semantics.

If an adopted runtime already does it, call it, constrain it, observe it, and verify it.

---

## What Ming Workbench owns

Ming Workbench should own the layer that remains valuable when the underlying model, provider, agent, or Harness changes:

- Reality grounding
- Intent
- Work Unit
- human Authority / Gates
- bounded execution requests
- Execution Run linkage
- Evidence projection
- independent Verification
- Acceptance
- Outcome
- Continuation
- human-facing product experience
- learning from real outcomes

DeepSeek Harness is an execution chassis, not the product.

AAOP is the first software-development domain-control profile, not the product.

Electron is a delivery shell, not the product.

---

## Three Truths

Keep these separate:

### Intent Truth
What the human actually wants to become true.

### Execution Truth
What the agent/runtime actually did.

### Outcome Truth
What is independently true in reality afterward.

An agent saying “done” is not Outcome Truth.

A Work Unit is complete only when evidence shows that Outcome Truth satisfies Intent Truth within the authorized boundary.

---

## Evidence discipline

Never claim more than the evidence proves.

- `L0` Source / Unit
- `L1` Runtime Component
- `L2` Distribution
- `L3` Installed Human Consumer Journey with real outcome
- `L4` L3 + real external provider through the real product path
- `L5` Real human intent achieved on a real project with independent outcome evidence

Do not call an API-driven test a human UI journey.

Do not call a successful installer “the product works”.

Do not call a provider connection “the provider path works” unless intake/execution/verification works through the product path.

Do not use model self-report as final evidence.

When tests are green but a real user cannot complete the intended journey, the real-user failure has higher authority for product truth.

---

## First proving ground

Per `docs/V1_PRODUCT_CONTRACT.md`, the first real proving ground after the
human-first entry loop is a **new low-risk idea** executed and verified
end-to-end, not Family Space. Family Space is a proving ground only after such a
low-risk real outcome round has succeeded.

Preferred progression:

```text
human-first confirmation round
→ small scratch Work Unit
→ real Ming Workbench Work Unit
→ new low-risk real idea executed and verified
→ real Family Space Work Unit (only after low-risk success)
→ repeated real-world outcomes
```

Do not keep optimizing Ming Workbench only against itself.

---

## Agent working loop

Work autonomously through this cycle:

```text
READ REALITY
↓
IDENTIFY HIGHEST-IMPACT REAL GAP
↓
CHECK EXISTING CAPABILITIES / UPSTREAM / GITHUB
↓
FORM A BOUNDED WORK UNIT
↓
REUSE OR ADAPT BEFORE BUILDING
↓
IMPLEMENT THE SMALLEST CORRECT CHANGE
↓
RUN NARROW CHECKS
↓
RUN THE REAL DELIVERY SURFACE
↓
READ REALITY AGAIN
↓
VERIFY
↓
RECORD EVIDENCE AT THE CORRECT LEVEL
↓
CONTINUE
```

Do not stop after every small task unless a real human gate is reached.

Human gates include destructive actions, expanded permissions, real financial cost, missing credentials, production release/merge authority, or unresolved value choices.

Routine engineering decisions should be handled autonomously.

---

## Anti-drift check before substantial changes

Ask:

1. Does this shorten the distance from real intent to verified outcome?
2. Does it help a non-technical Reality Owner complete real work?
3. Is this real capability or just more code?
4. Is there a real Work Unit that needs it now?
5. Can the result be independently re-read from reality?
6. Does the repo, Harness, AAOP, official ecosystem, or a mature GitHub project already solve it?
7. If the current Harness/model/provider disappeared tomorrow, would the Ming Workbench value still remain?

If the answer is mostly no, do not build it.

For the complete rationale and boundaries, read `docs/WORKBENCH_CONSTITUTION.md`.
