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
install mode: external source checkout
```

DeepSeek Harness is in developer preview. Do not silently float the commit.

At the 2026-08-14 review point, the source repository reported `0.1.0-rc.5`, but Ming Workbench CI proved that exact version was not installable from npm (`ETARGET`). Workbench therefore treats Harness as an external pinned source runtime until a distribution channel is separately verified.

## Workbench core

```bash
npm install
npm run doctor
npm run check
npm test
```

`npm run doctor` validates the reviewed Harness pin metadata without pretending the external runtime is installed.

## Harness runtime

Prepare a separate DeepSeek Harness source checkout at the exact commit recorded in `harness.lock.json`, install/build it using the upstream instructions, then point Workbench at that checkout.

macOS/Linux example:

```bash
export MING_HARNESS_CHECKOUT=/absolute/path/to/deepseek-harness
npm run doctor:harness
```

PowerShell example:

```powershell
$env:MING_HARNESS_CHECKOUT = 'C:\path\to\deepseek-harness'
npm run doctor:harness
```

The full doctor verifies both the source package version and exact Git commit. Start the Harness Web UI from that reviewed checkout using its own documented command surface.

Ming Workbench does not deep-fork Harness UI or runtime.

## What exists in the first slice

- a minimal evidence-bearing Work Unit model;
- a completion invariant that rejects evidence-free `done` states;
- an isolated Harness compatibility seam;
- the first `development-aaop` Domain Pack descriptor and AAOP intake envelope;
- conflict-aware repository-frontier intake grounded in a real Family Space pilot;
- architecture boundaries for the first end-to-end development slice.

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
→ repository-frontier admission
→ AAOP Route / authorization / acceptance
→ DeepSeek Harness execution
→ repository + test/runtime readback
→ evidence-backed completion
```
