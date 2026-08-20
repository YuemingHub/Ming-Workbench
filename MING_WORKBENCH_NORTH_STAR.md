# Ming Workbench North Star — Mandatory Read Before Work

> **Highest product direction.** Every coding agent, review agent, cloud agent, local agent, and future contributor must read and understand this file **before reading implementation details or making changes**.
>
> `docs/WORKBENCH_CONSTITUTION.md` operationalizes this direction into durable product and engineering rules. `docs/V1_PRODUCT_CONTRACT.md` remains authoritative for the current V1 human-first entry experience. Repository reality remains authoritative for factual implementation status. If an agent believes this North Star itself should change, that is a human-level product decision and must not be weakened silently in code.

---

## 1. The sentence that defines Ming Workbench

> **人负责现实、目标、价值判断和最终责任。**
>
> **Ming Workbench 负责理解目标，判断需要什么能力，从不断变化的 AI 与开源世界中寻找并组合当下最合适的技术，控制它去执行，再独立验证现实是否真的变成了人想要的样子。**

Therefore:

> **我们不是造工具的人。**
>
> **我们是替普通人驾驭整个工具世界的人。**

The earlier shorthand remains valid:

> **人负责理解现实，Ming Workbench 负责把它实现出来。**

This document makes the middle of that sentence explicit: Workbench must take responsibility for the technical complexity between human intent and verified reality.

---

## 2. What the human owns, and what Ming owns

### Human owns

- reality as they experience and understand it;
- goals and desired change;
- values and trade-offs that cannot be delegated safely;
- consequential authorization;
- final responsibility and confirmation.

The human should **not** be required to understand or research the technical ecosystem in order to make progress.

### Ming Workbench owns

- understanding and grounding the stated goal;
- identifying the capabilities actually required;
- checking what capabilities already exist;
- discovering better existing capabilities when needed;
- evaluating fit, trust, compatibility, cost, permissions, and maintenance risk;
- selecting and composing the smallest sufficient capability set;
- routing work to the appropriate runtime, agent, service, Skill, MCP, plugin, library, or external tool;
- constraining execution to the authorized boundary;
- reading reality back independently after execution;
- collecting evidence and deciding whether the intended outcome actually happened;
- learning from real Work Units which capability combinations actually work.

**Technology selection is a Workbench responsibility, not a burden shifted back to the user.**

---

## 3. Capability is the product abstraction

Ming Workbench should reason in terms of **Capability**, not ecosystem jargon.

A capability may be implemented by:

- a Skill;
- an MCP server;
- a Harness/Cordis plugin;
- a native tool;
- an Agent or Subagent;
- a workflow already provided by an adopted runtime;
- a model/provider;
- a browser automation system;
- an API or SaaS service;
- a mature GitHub project;
- a local library or executable;
- another runtime such as Codex, Claude Code, or a future system that does not yet exist.

These are implementation forms, not user concepts.

Normal users should not have to choose between “Skill / MCP / Plugin / Agent / Runtime”. They should say what they want to become true. Ming decides what technical form is appropriate.

---

## 4. The core loop

```text
Human reality / intent
        ↓
Reality Intelligence
What actually needs to become true?
        ↓
Work Unit
        ↓
Capability Resolution
What capabilities are required?
What already exists?
What is missing?
        ↓
Capability Qualification
Which candidate is the best fit?
Is it trustworthy, compatible, bounded, and worth using?
        ↓
Capability Composition
Use the smallest sufficient combination
        ↓
Domain Control when needed
(example: software development → AAOP)
        ↓
Execution Runtime
(Harness / Codex / Claude / future runtime / service)
        ↓
Real-world execution
        ↓
Independent reality readback
        ↓
Evidence / Verification
        ↓
Outcome
        ↓
Continuation and learning
```

The center of the system is the human's intended reality, not any runtime, protocol, repository, or plugin ecosystem.

---

## 5. Reuse Before Build is a product behavior, not only an engineering rule

When a Work Unit exposes a capability need, the default behavior is:

```text
Understand the capability need
↓
Check current project capability
↓
Check already-installed/adopted capabilities
↓
Check current runtime ecosystem
↓
Check official capabilities
↓
Check mature maintained open-source capabilities
↓
Qualify candidates
↓
Reuse directly or through a thin adapter
↓
Only if a real unmet gap remains:
build the smallest missing layer
```

Preference order:

```text
Already available and proven
> official capability
> mature maintained capability
> thin adapter
> bounded experimental capability
> build ourselves
```

**Build is the last resort, not the default reflex of a coding agent.**

Before creating significant new infrastructure, an agent must be able to name the real Work Unit and the demonstrated gap that existing capabilities could not satisfy.

---

## 6. Do not turn Ming into a plugin marketplace

Ming Workbench must not solve technical abundance by exposing technical abundance to the user.

Do not make the normal experience:

- browse 500 Skills;
- compare 100 MCP servers;
- choose a model runtime;
- pick a plugin stack;
- configure an orchestration framework;
- research which GitHub project to install.

That recreates the exact burden Ming exists to remove.

The normal experience should be:

```text
Human: this is what I want to happen.
Ming: I understand the outcome. I will handle the technical path.
```

Technical details may be available for inspection and expert control, but they are not the normal path.

---

## 7. Ming must not be locked to DeepSeek Harness

DeepSeek Harness is currently a strong execution chassis and should be reused heavily where it fits.

But:

- Harness is not Ming Workbench;
- AAOP is not Ming Workbench;
- Electron is not Ming Workbench;
- any current model/provider is not Ming Workbench;
- any particular Skill/MCP/plugin ecosystem is not Ming Workbench.

Workbench should connect to replaceable execution systems through the thinnest useful adapters and profiles.

If Codex, Claude Code, another open-source runtime, or a future system becomes better for a Work Unit, Ming should be able to choose it without losing its own identity or product truth.

The stronger the external ecosystem becomes, the thinner Ming should become at the execution layer.

---

## 8. The two long-term intelligences

### Reality Intelligence

Answers:

> **What does this person actually want to become true?**

It grounds intent, constraints, values, acceptance, and human responsibility.

### Capability Intelligence

Answers:

> **Given today's technical world, what is the best way to make that happen?**

It understands available capabilities, fit, trust, cost, permissions, compatibility, composition, replacement, and when no additional tool should be used at all.

These two intelligences meet at the Work Unit and are closed by independent evidence.

---

## 9. Capability discovery is not permission to install anything automatically

Automatic discovery and automatic comparison are desirable.

Unbounded supply-chain execution is not.

A candidate capability must be qualified before trusted use. Qualification should consider, as applicable:

- source and provenance;
- current maintenance status;
- version and compatibility;
- license;
- requested filesystem/network/system permissions;
- credential access;
- external cost;
- data handling;
- reversibility;
- isolation/sandbox suitability;
- evidence that the capability actually performs the required job.

Prefer isolated evaluation before durable adoption.

Human authorization remains mandatory for meaningful consequence such as expanded permissions, new secrets, real financial cost, production mutation, destructive action, or unresolved value trade-offs.

**Automate technical complexity; do not automate away human responsibility.**

---

## 10. Capability success is measured by outcome, not installation

The following are not sufficient success criteria:

- package installed;
- MCP connected;
- plugin loaded;
- Agent returned `done`;
- model produced plausible output;
- tests unrelated to the real user path passed.

Capability selection succeeds only when it helps the Work Unit produce the intended real-world outcome and that outcome can be independently re-read and supported by evidence.

```text
Capability
↓
Execution
↓
Reality readback
↓
Evidence
↓
Verification
↓
Intent satisfied or not satisfied
```

This is why Workbench owns Evidence, Verification, and Outcome even when execution is delegated to external systems.

---

## 11. The accumulating moat is Capability Evidence

Ming Workbench should not accumulate tools for their own sake.

It should accumulate evidence about:

> **For this kind of real goal, under these constraints, which capability or capability combination actually worked?**

Over repeated real Work Units, useful durable knowledge includes:

- which runtimes are reliable for which task classes;
- which tools fail despite confident agent self-reports;
- which capability combinations produce real outcomes with less permission, cost, or complexity;
- which capabilities are trustworthy and maintained;
- which user/context patterns require different technical approaches;
- when an existing capability should be replaced;
- when the correct choice is to use no additional tool.

This **Capability Evidence** is more valuable than owning another internal runtime or a large static catalog of plugins.

---

## 12. First implementation direction: Capability Resolution V0

Do **not** respond to this North Star by building a large Capability Platform.

The first proof should be deliberately small:

> **When Ming encounters a real low-risk Work Unit that current capabilities cannot complete, it can identify the missing capability, search existing trusted sources, qualify a candidate, use it in a bounded way, and verify the original real outcome — instead of immediately writing a new implementation.**

V0 does not require:

- a plugin marketplace;
- a universal registry;
- a capability graph database;
- a new workflow engine;
- a new orchestration runtime;
- a new MCP/Skill protocol;
- a large recommendation system.

Start from one real Work Unit. Let repeated real failures earn the architecture.

---

## 13. Mandatory anti-drift questions for every agent

Before any substantial new capability or infrastructure is accepted, answer:

1. What real human outcome does this shorten the path to?
2. What capability is actually needed, stated without naming a preferred implementation?
3. What existing project/runtime/Skill/MCP/plugin/service/open-source capability was checked first?
4. Why is direct reuse or a thin adapter insufficient?
5. Are we solving the user's problem, or creating another technology-management problem for the user?
6. Can the selected capability be replaced later?
7. What new permissions, secrets, costs, supply-chain risks, or irreversible effects does it introduce?
8. How will reality be independently re-read after execution?
9. What evidence proves the original intent was satisfied?
10. If external AI tools become dramatically stronger next year, will this Ming-owned code still deserve to exist?

If these questions do not produce strong answers, do not build the new infrastructure.

---

## 14. Mandatory reading order for future agents

Before making changes:

1. **Read this file completely.**
2. Read `AGENTS.md`.
3. Read `docs/WORKBENCH_CONSTITUTION.md`.
4. Read `docs/V1_PRODUCT_CONTRACT.md` for the current V1 user-facing contract.
5. Read current repository / branch / PR / tests / evidence relevant to the task.
6. Identify the real Work Unit and highest-impact gap.
7. Search existing capabilities before proposing new infrastructure.
8. Only then design or implement.

An agent that has not done this should not modify Ming Workbench.

---

## 15. Final calibration

When uncertain, return to these three questions:

> **人真正想要什么？**
>
> **今天什么能力最适合让它发生？**
>
> **它到底有没有真的发生？**

Everything else is replaceable machinery.
