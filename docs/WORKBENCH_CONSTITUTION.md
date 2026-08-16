# Ming Workbench Constitution

> **North Star**
>
> **人负责理解现实，Ming Workbench 负责把值得发生的事情组织起来，让现成的最强 AI 能力去执行，并证明它真的发生了。**
>
> Humans own reality, judgment, values, and responsibility. Ming Workbench turns that intent into controlled execution, independent evidence, and verified outcomes.

This document is the durable product and engineering constitution for Ming Workbench. It exists to prevent drift as models, agent runtimes, repositories, contributors, and implementation details change.

It is intentionally more stable than any current architecture, branch, framework, provider, desktop shell, or release plan.

---

## 1. What Ming Workbench is

Ming Workbench is not primarily a coding product. It is a **reality-to-outcome workbench** for people who may possess deep real-world experience and judgment without possessing software-engineering expertise.

Its job is to close this loop:

```text
Reality
  ↓
Intent
  ↓
Work Unit
  ↓
Authority / Gate
  ↓
Execution through existing best-in-class capabilities
  ↓
Reality readback
  ↓
Evidence
  ↓
Verification
  ↓
Outcome
  ↓
Continuation
```

The core product question is never merely:

> Did an agent run?

It is:

> Did reality change in the way the human intended, within the authorized boundary, and what evidence proves it?

---

## 2. The three truths

Ming Workbench must preserve three distinct truths.

### 2.1 Intent Truth

What does the human actually want to become true in reality?

The human remains the Reality Owner. Workbench may help clarify, structure, decompose, and surface consequences, but it must not silently replace human intent with a convenient technical proxy.

### 2.2 Execution Truth

What did the execution system actually see, call, decide, modify, and return?

Execution runtimes such as DeepSeek Harness may own canonical session and tool-execution facts. Ming Workbench should reference and project those facts rather than duplicating them.

### 2.3 Outcome Truth

What is true in the world after execution?

Examples include repository state, file contents, test results, runtime behavior, browser behavior, deployment state, API response, external system state, or human confirmation.

The executor's statement that work is complete is not Outcome Truth.

Ming Workbench completes a Work Unit only when Execution Truth and Outcome Truth provide sufficient evidence that Intent Truth has been satisfied.

---

## 3. Reuse Before Build

This is a hard architectural rule, not a style preference.

> **Do not rebuild mature capabilities that already exist unless a real Work Unit has demonstrated a concrete unmet gap.**

Before implementing any non-differentiating infrastructure, an agent must first inspect:

1. the current Ming Workbench repository;
2. DeepSeek Harness and other already-adopted runtimes;
3. AAOP and the relevant domain-control layer;
4. official ecosystem capabilities;
5. mature open-source projects on GitHub.

The preference order is:

```text
Direct reuse
  > thin adapter
  > reuse the mature design pattern
  > build the smallest missing layer ourselves
```

### 3.1 Reuse does not mean collecting dependencies

Do not import projects merely because they are interesting.

A reused capability must solve a demonstrated need, fit the product boundary, and have acceptable maintenance, licensing, security, and operational characteristics.

### 3.2 Required reasoning before new infrastructure

Before adding a new runtime, engine, scheduler, orchestration layer, protocol, framework, or major internal abstraction, record:

- the real Work Unit or failure that exposed the gap;
- what existing repository capability was checked;
- what upstream/open-source alternatives were checked;
- why direct reuse or a thin adapter is insufficient;
- the smallest capability Ming Workbench must actually own.

If there is no real gap evidence, do not build the infrastructure.

---

## 4. What Ming Workbench should own

Ming Workbench should increasingly own the layer that remains valuable even if the underlying model, provider, coding agent, harness, browser agent, or tool runtime changes.

Core ownership includes:

- Reality grounding;
- Intent;
- Work Unit;
- human Authority and Gates;
- bounded execution requests;
- Execution Run identity and linkage;
- Evidence projection;
- independent Verification;
- Acceptance;
- Outcome;
- Continuation;
- human-facing product experience;
- durable learning from real Work Units and outcomes.

This is the differentiated layer.

---

## 5. What Ming Workbench should not own by default

Do not create duplicate foundational infrastructure merely for control, uniformity, convenience, or anticipated future use.

Default non-goals include a new:

- Ming Agent Loop;
- Ming coding agent;
- Ming MCP runtime;
- Ming tool protocol;
- Ming tool registry when an adopted runtime already provides one;
- Ming Subagent framework;
- Ming Workflow engine;
- Ming Goal engine;
- Ming browser automation framework;
- Ming Git implementation;
- Ming model runtime;
- Ming provider SDK abstraction beyond the thinnest product-required adapter;
- duplicate Harness session ledger;
- duplicate background-job runtime;
- duplicate AAOP lifecycle or bootstrap system.

If an existing runtime can perform the capability, Ming Workbench should call it, constrain it, observe it, and verify the result rather than reimplementing it.

---

## 6. Current responsibility boundaries

These boundaries may evolve, but the direction is stable.

### Ming Workbench

Human-facing reality loop:

```text
Intent
Work Unit
Authority / Gate
Execution Run linkage
Evidence
Verification
Outcome
Continuation
```

### AAOP

The first software-development domain-control profile.

AAOP exists to keep software development bounded, reviewable, and controlled. Ming Workbench must not duplicate AAOP's canonical development-control semantics merely to simplify the UI.

Other future domains may use other domain packs rather than AAOP.

### DeepSeek Harness

Execution chassis.

Harness may own agent execution, sessions, tools, MCP integration, subagents, goals, workflows, and other execution-plane capabilities. Ming Workbench should use them rather than rebuild them.

Harness is replaceable. The Workbench reality loop must survive a future runtime replacement.

### Models, providers, tools, browser agents, external services

Replaceable capabilities.

The stronger these become, the less execution infrastructure Ming Workbench should need to own itself.

---

## 7. Product shape is not the North Star

Electron is not the product.

The Windows installer is not the product.

A chat interface is not the product.

A dashboard is not the product.

AAOP is not the product.

DeepSeek Harness is not the product.

The current desktop application is simply the first delivery surface that allows a non-technical Reality Owner to use the reality loop.

Product form may change as real use teaches us what is necessary.

The North Star should remain stable while the product form stays evolvable.

---

## 8. V0.1 success criterion

The first meaningful Ming Workbench exists when a non-technical user can:

```text
install/open Ming Workbench
→ select a real project
→ state a real goal in ordinary language
→ have Workbench read current reality
→ see what Workbench understood
→ authorize only the decisions that require human responsibility
→ let existing execution capabilities perform the bounded work
→ have Workbench re-read reality independently
→ see evidence of what actually changed
→ know whether the original goal was achieved
→ continue from that result later
```

A large feature count is not a substitute for this loop.

A green provider connection is not a substitute for this loop.

A successful installer is not a substitute for this loop.

A large passing test suite is not a substitute for this loop.

---

## 9. Evidence must never be stronger than reality

Ming Workbench's own engineering process must follow the same evidence discipline as its product.

Use the following evidence levels:

### L0 — Source / Unit

Code exists and local/unit contracts pass.

### L1 — Runtime Component

A real component or runtime integration works.

### L2 — Distribution

The packaged/installed product starts and its distribution contract works.

### L3 — Installed Human Consumer Journey

A fresh installed product, driven through the real user-facing path, completes a meaningful Work Unit with a real outcome.

### L4 — Live Provider Dogfood

L3 plus a real external model/provider through the real product credential/configuration path.

### L5 — Real Project Outcome

A real human intent on a real project is achieved and independently supported by outcome evidence.

Do not relabel L0/L1/L2 integration coverage as L3 product usability.

Do not call an API-driven test a human UI journey merely because the installed EXE was launched.

Do not call model output proof of completion.

---

## 10. Reality beats tests when they disagree

When automated tests are green but a real user cannot complete the intended journey, the real-user failure has higher authority for product truth.

The correct response is not to defend the tests.

The correct response is to identify what the tests were actually proving, rename/reclassify them if necessary, and add acceptance coverage closer to the real delivery surface.

Tests are evidence. They are not reality itself.

---

## 11. Family Space is the first real-world proving ground

Family Space is not merely a demo repository for Ming Workbench.

It is the first serious real-world product environment where Ming Workbench must prove that it can convert a human's real judgment into a controlled, verified result.

A healthy progression is:

```text
small scratch Work Unit
→ real Ming Workbench repository Work Unit
→ real Family Space Work Unit
→ repeated Family Space outcomes
→ broader domains only after real evidence
```

Do not keep optimizing Ming Workbench only against itself. A self-referential workbench can become an engineering toy that proves its own assumptions.

Real products, real users, real failures, real responsibility, and real evidence are the calibration surface.

---

## 12. Long-running autonomy: direction, not premature infrastructure

The long-term vision includes work that can continue for hours, days, or longer while humans remain responsible for goals and consequential decisions.

The target is not merely autonomous coding. It is controlled **autonomous reality execution**.

However, do not build a new durable orchestration engine preemptively.

First use the strongest existing capabilities from Harness and the ecosystem. Only introduce an additional continuation mechanism if real Work Units prove a gap such as:

- process restart continuity;
- machine restart continuity;
- multi-day external waiting;
- external event wake-up;
- resuming authority safely after long suspension.

The gap must be demonstrated before the infrastructure is created.

---

## 13. Human authority must remain explicit

More capable AI should increase human leverage, not silently erase human responsibility.

Ming Workbench should automate complexity while preserving human control over decisions that carry meaningful consequence.

Agents should stop for genuine human gates such as:

- irreversible or destructive actions;
- expanded permissions or authority;
- real financial cost;
- secrets or credentials that are not already available through an authorized product path;
- production release or merge authority when not explicitly granted;
- materially different value choices that cannot be resolved from the stated intent.

Routine engineering choices should not be escalated merely to avoid responsibility.

---

## 14. Agent operating protocol

Every agent entering this repository should work in the following loop:

```text
READ REALITY
↓
IDENTIFY THE HIGHEST-IMPACT REAL GAP
↓
CHECK EXISTING CAPABILITIES / UPSTREAM / GITHUB
↓
FORM ONE BOUNDED WORK UNIT
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
CONTINUE TO THE NEXT FRONTIER
```

Do not stop after every small engineering task unless a real human gate is reached.

Do not report success more strongly than the evidence permits.

---

## 15. Anti-drift questions for every substantial change

Before accepting a substantial new capability, ask:

1. Does this reduce the distance from a real human intent to a verified real-world outcome?
2. Does it make Ming Workbench more useful to a person who may not understand the underlying technology?
3. Is this adding real capability, or merely adding code?
4. Is there a real Work Unit that needs it now?
5. Can the outcome be independently re-read from reality?
6. Does the current repository, Harness, AAOP, an official ecosystem, or mature GitHub project already provide this capability?
7. If DeepSeek Harness, the model, or the provider were replaced tomorrow, would the Ming Workbench value in this change remain?

If the answer is mostly no, do not build it.

---

## 16. Thin is a feature

Ming Workbench should not measure progress by codebase size.

As models, harnesses, coding agents, browser agents, and open-source infrastructure improve, Ming Workbench should be able to become thinner at the execution layer while becoming stronger at:

- understanding intent;
- grounding reality;
- preserving authority;
- selecting and composing existing capabilities;
- collecting evidence;
- verifying outcomes;
- learning from real work.

The moat is not the number of internal engines.

The durable value is the method and accumulated evidence for turning human reality and judgment into systems and outcomes that actually work.

---

## 17. Conflict rule

When implementation convenience, framework enthusiasm, test convenience, or architecture elegance conflicts with this constitution, this constitution wins.

When this document conflicts with current repository reality about what code actually does, repository reality wins for factual status — then update the documentation so claims match reality.

When a future agent believes this constitution itself should change, treat that as a human-level product decision rather than silently weakening it in an implementation PR.
