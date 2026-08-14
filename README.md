# Ming Workbench

Ming Workbench is an intent-to-evidence AI workbench. It uses existing agent runtimes instead of rebuilding them.

The first development profile is:

- Workbench: human-facing `Space / Work Unit / Gate / Evidence / Asset / Outcome`
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

## What is intentionally not implemented yet

- a duplicate agent loop;
- a duplicate workflow engine;
- a duplicate MCP/Skill protocol;
- a duplicate scheduler/ledger;
- Creator/Research/Family Service Packs;
- a replacement Harness UI.

The next milestone is the first real product-development Work Unit:

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
