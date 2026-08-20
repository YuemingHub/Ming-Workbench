# Ming Workbench

> **Mandatory first read for every agent and contributor: [`MING_WORKBENCH_NORTH_STAR.md`](./MING_WORKBENCH_NORTH_STAR.md).** It defines the highest product direction: humans own reality, goals, values, and final responsibility; Ming Workbench owns understanding the goal, identifying required capabilities, finding and composing the best existing technology, controlling execution, and independently verifying that reality actually changed as intended.
>
> **V1 product authority is [`docs/V1_PRODUCT_CONTRACT.md`](./docs/V1_PRODUCT_CONTRACT.md)** — the human-first entry (letter → 开始 → three entries → conversation → one smallest complete real outcome → round agreement → confirmation).
>
> **Agents: read [`MING_WORKBENCH_NORTH_STAR.md`](./MING_WORKBENCH_NORTH_STAR.md) first, then [`AGENTS.md`](./AGENTS.md), then [`docs/WORKBENCH_CONSTITUTION.md`](./docs/WORKBENCH_CONSTITUTION.md) before changing the repository.**
>
> The durable rule is **Reuse Before Build**: Ming Workbench owns the Reality → Intent → Capability Resolution → Evidence → Outcome loop and should reuse or thinly adapt existing execution infrastructure rather than rebuild it.

Ming Workbench is an intent-to-evidence AI workbench. It uses existing agent runtimes instead of rebuilding them.

Its durable product role is not to own more tools. It is to take responsibility for technical complexity on behalf of a non-technical Reality Owner:

```text
human intent
→ understand the required capability
→ discover / qualify / compose existing best-fit capabilities
→ bounded execution through replaceable runtimes
→ independent reality readback
→ evidence-backed outcome
```

The first development profile is:

- Workbench: human-facing `Space / Work Unit / Gate / Evidence / Asset / Outcome`
- capability selection: `Capability Resolution` (start small; no marketplace/platform build)
- software control protocol: AAOP
- execution chassis: DeepSeek Harness
- durable execution: LoopX only after a proven continuity gap

## Reviewed Harness pin

The reviewed upstream snapshot is recorded in `harness.lock.json`:

```text
source package metadata: @deepseek-ai/dsh@0.1.0-rc.5
upstream commit: 47f943859bef60e4160492346772ded9b24f765a
reviewed: 2026-08-14
install mode: exact external source checkout
```

DeepSeek Harness is in developer preview. Do not silently float the commit.

At the 2026-08-14 review point, the source repository reported `0.1.0-rc.5`, but Ming Workbench CI proved that exact version was not installable from npm (`ETARGET`). Workbench therefore uses an exact source checkout until a distribution channel is separately verified.

## Quick start

Requirements: Git and Node `^22.19.0` or `>=24`.

```bash
npm install
npm run harness:prepare
npm run doctor:harness
npm run check
npm test
```

`harness:prepare` creates a Workbench-managed checkout under `.workbench/vendor/deepseek-harness`, fetches the exact reviewed commit, installs it with the reviewed pnpm version through `npx`, and verifies the source identity. No global pnpm installation or manual Harness clone is required.

See `docs/HARNESS_SETUP.md` for interactive Web and bring-your-own-checkout paths.

## What is already proven

The repository now has hosted evidence for the real automation chain, not only local contract tests:

```text
harness.lock.json exact SHA
→ exact DeepSeek Harness checkout
→ reviewed Harness workspace install
→ Workbench ACP launcher through Harness app-boot
→ ACP initialize / session/new / prompt
→ real DeepSeek adapter HTTP/SSE path
→ official Harness mock LLM
→ Harness Agent loop
→ ACP end_turn + expected assistant text
```

The production transport additionally verifies the AAOP Provider Execution Grant, exact repository/base/working ref for writes, read-only vs workspace-write sandbox mode, and strips task-specific GitHub/cloud/database secrets from the Harness child environment.

Harness/session completion remains execution evidence, not final Work Unit completion.

## What exists in the first slice

- a minimal evidence-bearing Work Unit model;
- a completion invariant that rejects evidence-free `done` states;
- conflict-aware repository-frontier admission grounded in a real Family Space pilot;
- a narrow Workbench→AAOP Developer Request boundary that does not duplicate AAOP's canonical Intake Envelope;
- AAOP Provider Execution Grant consumption with exact authorization checks;
- a repository-owned Harness overlay and single-agent `development-aaop` Preset;
- a guarded cross-platform Harness ACP transport;
- exact-upstream hosted ACP smoke coverage;
- a one-command reviewed Harness source prepare path.

## Desktop v0.1 (Electron shell)

Ming Workbench Desktop is the first installable human-facing shell. Electron is
only a delivery shell; it owns no product/domain semantics. The Workbench
backend keeps owning project / AAOP / Harness / application semantics, and the
renderer is a plain human interface over the same loopback, token-protected,
fixed-project API as the Stage B local Web slice.

Chain proven on `agent/electron-desktop-v0-1`:

```text
launch desktop
→ choose/open one local project (native directory picker or --project)
→ Workbench fixes that project for the process lifetime
→ AAOP onboarding discovery (setup-required / ready / blocked)
→ explicit human authorization Gate before AAOP setup
→ canonical exact-stable AAOP bootstrap adapter
→ ordinary-language request
→ read-only AAOP Developer Intake over the reviewed Harness ACP transport
→ Work Unit / Gate / Evidence / next frontier in human language
→ clean close without residual Workbench/Harness child processes
```

Run in development:

```bash
npm install
npm run harness:prepare
npm run check
npm test
npm run desktop:dev              # builds .tmp, then opens the desktop shell
```

The desktop shell keeps the Stage B security boundary:

- `nodeIntegration: false`, `contextIsolation: true`, renderer `sandbox: true`;
- the preload exposes only a narrow Workbench Desktop API (`selectProject`,
  `quit`), never `fs`, `child_process`, `shell`, or raw `ipcRenderer`;
- navigation is limited to the Workbench-owned loopback backend, new windows and
  webviews are denied, and browser permission requests are refused;
- the backend still binds only to `127.0.0.1`, fixes one project, and ignores
  browser-supplied project roots.

Package on Windows:

```bash
npm run desktop:package          # portable single exe in dist-desktop/
npm run desktop:package:dir      # unpacked app in dist-desktop/win-unpacked/
```

The packaged app prefers the system `node` runtime for the backend sidecar and
falls back to Electron-as-node. A real read-only Intake needs the reviewed
Harness checkout, which is a runtime environment dependency: pass
`MING_HARNESS_CHECKOUT` (and the provider credentials the transport already
inherits, e.g. `DEEPSEEK_API_KEY`). Harness/session completion remains execution
evidence, never Work Unit completion. The first slice deliberately exposes no
write/execution UI.

See `docs/DESKTOP_V0_1_VERIFICATION.md` for the machine-level verification record
of this slice.

## What is intentionally not implemented yet

- a duplicate agent loop;
- a duplicate workflow engine;
- a duplicate MCP/Skill protocol;
- a duplicate scheduler/ledger;
- a plugin marketplace or universal capability registry;
- Creator/Research/Family Service Packs;
- a replacement Harness UI.

The next product-direction proof is **Capability Resolution V0**: on one real low-risk Work Unit, identify a missing capability, search and qualify an existing trusted capability, use it in a bounded way, and verify the original real-world outcome instead of reflexively rebuilding the capability.

The existing execution milestone remains:

```text
ordinary-language goal
→ Work Unit
→ repository-frontier admission
→ grounded AAOP Developer Intake
→ AAOP Provider Execution Grant
→ guarded Harness ACP execution
→ repository + test/runtime readback
→ AAOP acceptance
→ evidence-backed Work Unit completion
```
