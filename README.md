# Ming Workbench

Ming Workbench is an intent-to-evidence AI workbench. It uses existing agent runtimes instead of rebuilding them.

The first development profile is:

- Workbench: human-facing `Space / Work Unit / Gate / Evidence / Asset / Outcome`
- software control protocol: AAOP
- execution chassis: DeepSeek Harness
- durable execution: LoopX only after a proven continuity gap

## Reviewed runtime pin

This repository intentionally pins:

```text
@deepseek-ai/dsh@0.1.0-rc.5
upstream commit 47f943859bef60e4160492346772ded9b24f765a
reviewed 2026-08-14
```

DeepSeek Harness is in developer preview. Do not silently float the version.

## Start

```bash
npm install
npm run doctor
npm run check
npx @deepseek-ai/dsh@0.1.0-rc.5 web
```

The Harness Web UI starts independently. Ming Workbench does not deep-fork its UI or runtime.

## What exists in the first slice

- a minimal evidence-bearing Work Unit model;
- a completion invariant that rejects evidence-free `done` states;
- an isolated Harness compatibility seam;
- the first `development-aaop` Domain Pack descriptor and AAOP intake envelope;
- architecture boundaries for the first real development pilot.

## What is intentionally not implemented yet

- a duplicate agent loop;
- a duplicate workflow engine;
- a duplicate MCP/Skill protocol;
- a duplicate scheduler/ledger;
- Creator/Research/Family Service Packs;
- a replacement Harness UI.

The next milestone is a real vertical slice:

```text
ordinary-language goal
→ Work Unit
→ AAOP Route / authorization / acceptance
→ DeepSeek Harness execution
→ repository + test/runtime readback
→ evidence-backed completion
```
