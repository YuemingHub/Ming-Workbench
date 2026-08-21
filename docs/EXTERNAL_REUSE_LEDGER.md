# EXTERNAL REUSE LEDGER

**Purpose.** Before Ming Workbench builds any capability, we answer one
question only: *does the capability already exist maturely outside, and should
we reuse it instead of building it?* This ledger records that decision. It is
the `REUSE BEFORE BUILD` discipline in concrete form.

**Principle.**

```
Direct reuse > thin adapter > reuse mature design > build the smallest missing layer
```

We never rebuild a capability merely for control, uniformity, convenience, or
future speculation. A "not used" row here must be a capacity decision, not a
turf decision.

---

## Capability ledger

| Capability | Existing project | What it already solves | Reuse / integrate / benchmark / do not use | Why Ming still owns anything here |
|---|---|---|---|---|
| **Coding agent runtime** | DeepSeek Harness (bundled vendor), OpenHands, Cline, goose | Autonomously reads a repo, proposes a change, executes it, reports evidence. Harness is already the reviewed ACP execution chassis in this repo. | **Reuse / benchmark.** Keep Harness as the current `SoftwareExecutor`. Run a future apples-to-apples benchmark (Harness / OpenHands / Cline / goose) only after Founder Alpha is real, using the same real idea (Kill Test). Do not build a competitor. | Ming owns the *layer around* the executor: intent, agreement, route, human gate, Work Unit correlation, outcome interpretation, evidence, feedback loop. The executor is replaceable behind an execution seam. |
| **Agent loop** | Harness, OpenHands, Cline, goose, Autogen/CrewAI | Run the plan→act→observe loop of an agent. | **Reuse.** Already provided by the adopted Harness. Do not implement a second loop. | Ming never re-implements the loop; it constrains and verifies it. |
| **MCP runtime / protocol** | Official MCP spec, Harness MCP transport | Standardized tool transport. | **Reuse.** The official MCP runtime and Harness ACP transport are already adopted. Do not build a protocol. | Ming discusses providers through MCP; it does not own the transport. |
| **Browser automation framework** | Playwright, browser-use, Puppeteer | Open, click, type, read, reload, verify a real page. | **Reuse.** Adopt Playwright/browser-use for independent verification of produced web outcomes. | Ming owns *when/why* to verify and what to assert, not the browser engine. |
| **Workflow / integration engine** | n8n, Dify, Zapier | Orchestrate many steps, integrations, conditional flows across tools. | **Integrate (later, via MCP/API), do not build.** Today unsupported routes must stay honestly "not yet". When automation/wiring becomes a real product route, call n8n/Dify through adapters. | Ming owns intent→outcome truth, not the flow canvas. |
| **General LLM app runtime / RAG** | Dify, LangGraph | Host apps over models with memory, retrieval. | **Do not use for the alpha.** Overkill for a single-idea→single-outcome surface; also out of scope per the union Misson. Revisit only if a real route needs it. | Human-first synthesis currently passes the provider directly (Own-Key already in product). |
| **Web/app builder to a result** | v0 / Bolt / bolt.diy, Dyad | Produce an interactive web artifact from a prompt. | **Benchmark / possible direct reuse (later).** These overlap the *output shape* Ming produces. After Founder Alpha, compare Ming vs Dyad/Bolt on the same real idea (Kill Test). They are strong candidates to hand the execution slice to. | Ming proves intent continuity, honest outcome, and verification — which prompt-to-page tools do not. The executor being Dyad/Bolt vs Harness is an execution detail. |
| **Spec / planning framework** | GitHub Spec Kit, OpenSpec | Intent→spec alignment→plan→tasks→implementation→workflow→human checkpoint. | **Reuse the pattern, do not copy the DSL.** Do NOT build a second Spec Kit / new Specification DSL / second planning framework. Human-first already has conversation + synthesis + agreement; extend it only with the smallest missing layer observed in real use. | The confirmed agreement (willGet/solves/whereSee/notDoing) already carries the essential intent→execution contract. Ming owns that layer; a heavy spec DSL would duplicate it. |
| **Goal engine (executable goals)** | Harness Goal subsystem | Represent an executable current goal for the agent. | **Reuse.** Harness owns goal semantics; Ming maps a confirmed agreement onto an executable goal for the executor. Do not build a competing goal engine. | Ming compiles Intent Truth to an executable goal; Harness executes it. |
| **Git implementation** | Git | Version control. | **Reuse.** Underlying git only; hidden from the normal user. No reimplementation. | Ming owns baseline/identity/continuity semantics, not git itself. |
| **Package manager / runtime** | npm, bun, system node/python | Install and run dependencies. | **Reuse with Workbench-managed runtime.** Prefer a Workbench-managed runtime so a normal user never sees a terminal. | Ming hides it; it must not become a product step. |

---

## Decisions that keep Ming thin

- Ming does **not** own: coding agent, agent runtime, MCP runtime, workflow
  engine, browser engine, LLM, app-builder runtime, git, package manager,
  multi-agent framework, general spec framework.
- Ming **does** own: human idea / reality intent, Idea Space continuity, round
  agreement, execution-route choice, human gate, Work Unit correlation,
  outcome/evidence interpretation, real-use continuity, feedback→next
  iteration, and the human-facing product experience.
- **Executor seam:** concept is `SoftwareExecutor.execute(...)`; today's only
  implementation is Harness. Future candidates (OpenHands / Cline / goose /
  a builder like Bolt) plug in behind the seam. Keep the seam only as thin as
  real decoupling needs — do not add a second abstraction layer for beauty.

## Hard rule

A `Not used` entry must say *why* (capacity decision), not just "we have our
own". Absence of new infrastructure must be justified by absence of a real gap,
exactly as `AGENTS.md` requires.

---

## PR #29 (Stage 3 — Execution Bridge) capability review

Reviewed 2026-08-19 on branch `agent/stage3-execution-bridge-v1`. Question for
every new file: *does this add a capability Ming must own, or is it thin glue
over an existing external capability?*

| PR #29 capability | File | External state (2026-08) | Verdict | Evidence |
|---|---|---|---|---|
| Execution route classification | `src/execution/execution-route.ts` | Routing/intent classification is generic and everywhere (n8n Switch + AI intent analysis, Dify workflow branching, LangGraph router). **None** grounds in a *human-confirmed round agreement* (willGet/solves/whereSee/notDoing). Ming's is a ~50-line deterministic keyword gate on its own data model — not a classifier engine. | **KEEP (thin)** — do not grow into a routing engine; if real intent understanding is ever needed it is a model call, not a rules engine. | Code is deterministic keyword match over Ming's own agreement fields; external tools route generic user intent, not confirmed agreement. |
| Executable goal compilation | `src/execution/executable-goal.ts` | GitHub Spec Kit's Specify phase already produces user stories + acceptance criteria + success metrics; OpenSpec does propose/apply. Spec Kit is mature (v0.16.2, 1753 commits, active Aug 2026, 15+ agent integrations, now includes verify+document phases). | **KEEP (thin) + REUSE pattern** — Ming deliberately quotes the human's *own agreed words* as the contract, and does **not** build a spec DSL. If a deeper spec contract is ever needed, integrate the Spec Kit CLI rather than extending this file. | Ledger "Spec / planning framework" row already says *reuse the pattern, do not copy the DSL*. PR #29 follows it. |
| Bridge confirmed idea → Work Unit | `src/bridge/confirmed-to-execution.ts` | Harness Goal subsystem + session ledger; OpenHands sessions; OpenCode sessions (SQLite). External tools have sessions/ledgers but not "human-confirmed intent → work unit → run" correlation. | **KEEP** — this is the Intent Truth → Execution Truth correlation seam, the layer the constitution assigns to Ming. It stays thin: it only calls the existing `createIntakeWorkUnit` factory and never re-implements the execution chain. | `createIntakeWorkUnit` from `src/intake/project-aaop.js` is reused, not rebuilt. |
| Outcome projection | `src/outcome/project-outcome.ts` | n8n has evals/monitoring + human-in-the-loop guardrails; Dify has observability/logs; OpenHands has SWE-bench; Spec Kit has a verify phase. **None** makes "not_proven" (no independent evidence ⇒ do not claim success) a product-level default. External tools still report "done" on agent self-report. | **KEEP — strongest owned layer.** This is the Three Truths discipline (Intent/Execution/Outcome) made into a deterministic status map. It is the strongest anti-false-completion claim in the ecosystem comparison. | `not_proven` is the default for non-completed runs, no-mutation, and missing independent verification — the opposite of external "agent said done". |
| Stage 3 real-browser acceptance | `scripts/stage3-browser-verify.mjs` | Playwright / browser-use / Puppeteer. The script is a thin `playwright-core._electron` driver for one acceptance journey — test scaffolding, not product capability. | **REUSE** — already a reuse of Playwright (matches ledger "Browser automation framework" row). No new capability is introduced. | Script imports `playwright-core` `_electron`; no new browser engine is written. |

**PR #29 conclusion (kill-test lens).** Nothing in PR #29 is new infrastructure.
It is thin glue: (a) over Ming's own confirmed-intent layer, and (b) over tools
that already exist outside (Harness, Playwright, spec patterns). The two
genuinely-owned pieces are the confirmed-agreement grounding and the honest
`not_proven` outcome projection. If Dyad/Bolt/Spec-Kit were substituted for the
execution slice, PR #29's intent→outcome framing would still hold — which is
exactly what "Ming stays thin" requires. No capability here should be grown.

---

## Tracked ecosystem snapshot (2026-08-19)

Tracked per Issue #31. Current evidence, refreshed 2026-08-19.

| Project | State (2026-08) | What it could replace in Ming | Watch |
|---|---|---|---|
| Dyad | ~20-21k stars, local-first open-source AI app builder (Electron, Win/macOS/Linux), BYOK (OpenAI/Anthropic/Gemini/Ollama), Plan mode + per-action permission prompts, built-in git versioning, MCP servers, GitHub/Vercel deploy, Supabase full-stack, live preview. v1.11.0. | The whole "prompt → runnable web app" output slice. Requires Node.js install; first-run friction for non-developers. | **Prime Kill Test opponent** (App Builder arm). Directly overlaps Ming's execution output shape while being local-first + BYOK like Ming's own-key path. |
| bolt.diy | Official open-source Bolt.new (MIT source; WebContainers terms apply), ~20k stars, browser-based WebContainers, BYOK (OpenAI/Anthropic/Ollama/OpenRouter/Gemini/LMStudio/DeepSeek…), prompt→run→edit→deploy full-stack in browser. Bolt.new itself: 7M+ users, 75% of Fortune 500 adopted. | The "prompt → running full-stack app" slice with in-browser execution. | Benchmark as second App Builder arm; WebContainers is a real differentiator (in-browser Node). |
| OpenHands | ~74-81k stars, MIT core, strongest OSS Docker sandbox, EventStream, browser tool, Web UI/CLI/SDK/server, SWE-bench ~55%. | The autonomous coding executor (already listed as Harness benchmark candidate). | Executor benchmark arm. |
| Cline | ~61-65k stars, Apache-2.0 core, VS Code/Cursor/JetBrains/CLI agent, Plan/Act modes, per-action approval, MCP marketplace, 8M+ extension installs. | The IDE-native agent + approval-gated execution slice. | Its per-action approval model overlaps Ming's human gate — compare gate ergonomics in Kill Test. |
| goose | ~45-51k stars, Apache-2.0 (moved to Agentic AI Foundation), Rust, MCP-native, CLI + desktop, ACP server. | The ACP executor / MCP-connected agent slice. | ACP server role makes it a natural Ming adapter target. |
| GitHub Spec Kit | Very active Aug 2026 (v0.16.2, 1753 commits, 158 open PRs), specify CLI, 7-step linear flow (spec→plan→tasks→implement→verify→document→evolve), 15+ agent integrations, bundles/extensions ecosystem, dynamic constitution. | The "intent→spec→plan→verify" framing; now includes verify+document phases — converging on Ming's intent+verification story but as a dev workflow, not a non-technical product. | **Converging project.** Watch its verify phase; it has no "not_proven" honesty default. |
| OpenSpec | OPSX, YAML change proposals, propose→apply→archive, Web UI + CLI, Claude/Copilot focus. | Incremental spec management for existing codebases (1→n). | Lighter than Spec Kit; less relevant to Ming's 0→1 non-technical entry. |
| Dify | ~145k+ stars, Apache-2.0, LLMOps: agentic workflow builder, RAG, 50+ tools, multi-agent, self-host, 1M+ apps powered, v1.14.2 (May 2026). DifyTap multi-tenant CVEs (CVE-2026-41947/48/49/50) fixed in v1.14.2. | LLM app/agent runtime + workflow canvas (already "Integrate later, do not build"). | Security track record is a caution for multi-tenant claims. |
| n8n | ~180-185k stars, Sustainable Use License, 500-1400+ integrations, AI Agent node (Tools Agent default), human-in-the-loop guardrails, MCP both ways, evals/monitoring, self-host, "describe it, build it" AI workflow builder, v2.x. | Workflow/automation + agent orchestration + HITL guardrails + evals (already "Integrate later, do not build"). | Its human-in-the-loop + evals stack is the closest external neighbor to Ming's gate + verification — but it automates *flows*, not *intent truth*. |

**New entrants worth tracking (added 2026-08).**

- **OpenCode** (sst/opencode → anomalyco/opencode): ~162-188k stars, MIT, terminal-native Claude-Code alternative, HTTP daemon (Hono), multi-session, SQLite, WebUI/TUI/desktop, 75+ model providers, OpenAPI codegen. Strong candidate as a future `SoftwareExecutor` behind the seam.
- **Superpowers** (SDD ecosystem): test-first, evidence-driven methodology; "全流程管家" positioning. Its evidence-driven verification overlaps Ming's verification framing — watch.
- **Aider**: ~44-48k stars, Git-native terminal pair programming — a candidate executor benchmark arm.
- **Kilo Code**: ~26k stars, MIT, VS Code/JetBrains/CLI agent — a Cline-style candidate.
- **Anthropic Managed Agents**: managed multi-tenant + Computer Use still reportedly 1-2 years ahead of OSS — the commercial managed-agent ceiling to keep an eye on, not a reuse target.