# AGENTS.md — Start Here

All coding agents, review agents, cloud agents, and local agents working in this repository must read the mandatory root-level North Star **before making changes**.

Read in this order:

1. `MING_WORKBENCH_NORTH_STAR.md` — highest product direction; mandatory first read
2. `AGENTS.md` — this operating protocol
3. `docs/WORKBENCH_CONSTITUTION.md` — durable product and engineering law
4. `docs/V1_PRODUCT_CONTRACT.md` — authoritative for the current V1 human-first entry
5. the current repository state, branch, PR, tests, and evidence relevant to your task

Do not begin architecture or implementation work until you understand the North Star's central responsibility split:

> **人负责现实、目标、价值判断和最终责任。**
>
> **Ming Workbench 负责理解目标，判断需要什么能力，从不断变化的 AI 与开源世界中寻找并组合当下最合适的技术，控制它去执行，再独立验证现实是否真的变成了人想要的样子。**

Therefore:

> **我们不是造工具的人。我们是替普通人驾驭整个工具世界的人。**

The constitution operationalizes this direction. Current branch documents may be stale; repository reality wins for factual status. The North Star itself may only be changed as a human-level product decision.

---

## North Star

> **人负责理解现实，Ming Workbench 负责把值得发生的事情组织起来，让现成的最强 AI 能力去执行，并证明它真的发生了。**

Humans own reality, judgment, values, and responsibility.

Ming Workbench turns real intent into controlled capability selection, execution, evidence, verification, and outcome.

The core loop is:

```text
Reality
→ Intent
→ Work Unit
→ Capability Resolution
→ Authority / Gate
→ Existing best-fit execution capability
→ Reality readback
→ Evidence
→ Verification
→ Outcome
→ Continuation
```

Do not reduce Ming Workbench to a coding agent, Harness GUI, AAOP GUI, Electron app, chat UI, plugin marketplace, or workflow engine.

---

## Hard Rule: Reuse Before Build

Before implementing any non-core infrastructure, first check:

1. this repository;
2. already-installed/adopted capabilities;
3. DeepSeek Harness or the currently selected runtime;
4. AAOP / the current domain-control layer where relevant;
5. official ecosystem capabilities;
6. mature maintained open-source projects and services.

Preference order:

```text
Already available and proven
> official capability
> mature maintained capability
> thin adapter
> bounded experimental capability
> build the smallest missing layer ourselves
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
- AAOP lifecycle/bootstrap semantics;
- plugin/Skill/MCP marketplace exposed as the normal user experience.

If an adopted runtime or mature external capability already does it, call it, constrain it, observe it, and verify it.

---

## Capability Resolution before implementation

When a Work Unit exposes a technical need, do not jump directly from “problem” to “write code”.

Use this sequence:

```text
UNDERSTAND THE CAPABILITY NEED
↓
CHECK WHAT ALREADY EXISTS
↓
DISCOVER CANDIDATES IF NEEDED
↓
QUALIFY FIT / TRUST / PERMISSIONS / COST / COMPATIBILITY
↓
SELECT THE SMALLEST SUFFICIENT CAPABILITY SET
↓
USE OR THINLY ADAPT IT
↓
EXECUTE WITHIN AUTHORITY
↓
READ REALITY BACK
↓
VERIFY THE ORIGINAL OUTCOME
```

`Skill`, `MCP`, `Plugin`, `Agent`, `Runtime`, library, API, SaaS, and GitHub project are implementation forms of **Capability**. They are not concepts a normal user should have to research or choose.

Do not respond to this rule by building a universal Capability Registry, graph, marketplace, or recommendation platform. The first target is `Capability Resolution V0`: prove on one real low-risk Work Unit that Ming can discover and reuse a suitable existing capability instead of reflexively rebuilding it.

---

## What Ming Workbench owns

Ming Workbench should own the layer that remains valuable when the underlying model, provider, agent, or Harness changes:

- Reality grounding
- Intent
- Work Unit
- capability need identification
- capability selection and composition policy
- human Authority / Gates
- bounded execution requests
- Execution Run linkage
- Evidence projection
- independent Verification
- Acceptance
- Outcome
- Continuation
- human-facing product experience
- Capability Evidence learned from real outcomes

DeepSeek Harness is an execution chassis, not the product.

AAOP is the first software-development domain-control profile, not the product.

Electron is a delivery shell, not the product.

Any current Skill, MCP, plugin, model, provider, or runtime is replaceable.

---

## Three Truths

Keep these separate:

### Intent Truth
What the human actually wants to become true.

### Execution Truth
What the selected agent/runtime/capability actually did.

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

Do not call a capability successful merely because it installed, connected, or loaded. It succeeds only if it helps produce and verify the intended real-world outcome.

When tests are green but a real user cannot complete the intended journey, the real-user failure has higher authority for product truth.

---

## Human authority and capability safety

Automatic capability discovery and comparison are desirable. Unbounded installation or permission expansion is not.

Before adopting a new capability, qualify as applicable:

- provenance and maintenance;
- version / compatibility;
- license;
- filesystem / network / system permissions;
- credential access;
- external financial cost;
- data handling;
- reversibility;
- isolation suitability;
- real evidence that it performs the needed job.

Human gates include destructive actions, expanded permissions, new secrets/credentials, real financial cost, production release/mutation, or unresolved value choices.

**Automate technical complexity; do not automate away human responsibility.**

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
READ NORTH STAR + REALITY
↓
IDENTIFY HIGHEST-IMPACT REAL GAP
↓
STATE THE CAPABILITY NEED WITHOUT PRESELECTING IMPLEMENTATION
↓
CHECK EXISTING CAPABILITIES / UPSTREAM / GITHUB
↓
FORM A BOUNDED WORK UNIT
↓
REUSE OR ADAPT BEFORE BUILDING
↓
IMPLEMENT ONLY THE SMALLEST MISSING CHANGE
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

Routine engineering decisions should be handled autonomously.

---

## Anti-drift check before substantial changes

Ask:

1. What real human outcome does this shorten the path to?
2. What capability is actually required, stated independently of implementation?
3. Does it help a non-technical Reality Owner complete real work without learning more technical machinery?
4. Is this real capability or just more code?
5. Is there a real Work Unit that needs it now?
6. Can the result be independently re-read from reality?
7. Does the repo, Harness, AAOP, official ecosystem, or a mature GitHub project/service already solve it?
8. Why is direct reuse or a thin adapter insufficient?
9. Is the chosen capability safely replaceable?
10. What permissions, secrets, costs, supply-chain risks, or irreversible effects does it introduce?
11. If the current Harness/model/provider disappeared tomorrow, would the Ming Workbench value still remain?
12. If external AI tools become dramatically stronger next year, will this Ming-owned code still deserve to exist?

If the answer is mostly no, do not build it.

For the highest direction read `MING_WORKBENCH_NORTH_STAR.md`; for the complete durable rules and boundaries read `docs/WORKBENCH_CONSTITUTION.md`.


<!-- AAOP:BEGIN -->
## Adaptive Agent Orchestration Protocol (AAOP)

For non-trivial developer work, read `.aaop/ORCHESTRATOR.md`, begin with
`.aaop/skills/developer-intake/SKILL.md`, select one primary route, then load
`.aaop/skills/route-execution/SKILL.md` plus only `.aaop/routes/<route-id>.json`.

Accept ordinary developer language. Read accessible project evidence before asking
for facts already present. For greenfield ideas, separate the observable outcome
from technology names: Agent/MCP/RAG/vector DB/graph/memory and similar terms are
candidate solutions unless explicitly established as hard constraints. Define an
evidence-bearing first slice before architecture and do not make a non-technical
user choose a stack the system can derive later.

For review/adoption/audit requests, define the decision first, verify material
external claims against current source/status when practical, contextualize risk,
and remain read-only unless mutation is explicitly requested.

Establish the relevant current baseline/source authority before treating old issues,
PRs, branches, status files, or prior AI conclusions as current truth. Apply route
pressure guards when their condition is present.

Before relying on an existing AAOP installation when integrity is uncertain, use
`python .aaop/tools/health.py . --json`. Treat `drifted`, `incomplete`, or invalid
manifest/bootstrap states as evidence to review, not permission to overwrite local
state. The health check is best-effort accidental-drift detection, not a security
trust root.

Reuse current host/repository capabilities first. If work is blocked, distinguish
missing evidence, environment/network limits, authorization, credentials, external
dependencies, and product decisions from a genuine technical capability gap. Only
a proven capability gap justifies provider selection, and then choose the smallest
provider surface. When a selected Recipe has an applicable `adoption_review`,
re-check it against current upstream and the actual deployment context rather than
using it as a permanent provider verdict. Do not widen access or install workaround
machinery to bypass a non-capability blocker. Verify the outcome; if safely blocked,
preserve unknown state and report the smallest legitimate unblock rather than
claiming completion.

Canonical orchestration Skills live under `.aaop/skills/`.
<!-- AAOP:END -->
