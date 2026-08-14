# Pilot 001 — Family Space repository frontier intake

Date: 2026-08-14

## Real trigger

Ming Workbench was ready to start a first real development task against `YuemingHub/Family-Space`, but that repository already had active work. Starting another implementation from chat memory alone could collide with current branches.

The Workbench therefore inspected current GitHub evidence before choosing a development slice.

## Observed active work

At pilot observation time:

- Family Space PR #267 — `release: establish single S0 candidate from current production`
- Family Space PR #268 — `feat(parent): add hold-to-talk voice input`

The current changed-file evidence proves material overlap between those active branches, including shared authority/runtime surfaces such as:

- `package.json`
- `src/products/family/routes/api.js`
- `src/services/ai-engine-core.js`

PR #268 additionally owns active parent voice/UI surfaces including:

- `react-vite/src/parent/hooks/useVoiceRecorder.ts`
- `react-vite/src/parent/pages/DialoguePage.tsx`
- `src/services/parent-language-pressure.js`
- `src/tests/test-voice-asr.js`

PR #267 additionally owns current S0/Safety/conversation surfaces including:

- `src/services/crisis-parent-response.js`
- `src/services/safety-gate.js`
- `src/services/conversation-mode-router.js`

## Product requirement learned from the pilot

A development Work Unit must not claim that a slice is safe to start until its intended file surface is known and compared against current active repository work.

Decision contract:

```text
intended file surface unknown
→ scope-required

known surface overlaps active work
→ conflict
→ narrow / reroute / handoff before implementation

known surface does not overlap active work
→ safe to proceed to the next AAOP gate
```

This is a repository-frontier check, not a replacement for AAOP. AAOP remains authoritative for Route, Working Contract, authorization, Task Pod ownership and final engineering acceptance.

## Implemented delta

`src/domain-packs/repository-frontier.ts` now provides:

- `RepositoryFrontier`
- `ActiveWorkItem`
- occupied-file collection
- `assessRepositoryFrontier()`
- explicit `safe | conflict | scope-required` outcomes

The function deliberately refuses to infer safety when intended files are unknown.

## Verification

Local independent execution on the implementation snapshot:

```text
tsc --noEmit
PASS

node --test test/*.test.mjs
5 tests
5 passed
0 failed
```

The tests prove:

1. unknown file scope does not become a false-safe decision;
2. `DialoguePage.tsx` collides with PR #268;
3. `ai-engine-core.js` reports both PR #267 and #268 as owners;
4. an unrelated `docs/evals/workbench-pilot.md` slice is allowed;
5. Work Unit completion still fails until an acceptance criterion carries recorded evidence.

GitHub CI is configured to verify the Harness pin metadata, typecheck, and run these unit tests on pull requests.

## CI found and corrected a false assumption

The first GitHub CI run failed before typecheck because Workbench declared `@deepseek-ai/dsh@0.1.0-rc.5` as an npm dependency. The upstream source checkout reported that package version, but the registry path returned:

```text
npm ERR! code ETARGET
No matching version found for @deepseek-ai/dsh@0.1.0-rc.5
```

This was treated as integration evidence, not hidden or bypassed.

The corrected boundary is now:

```text
Workbench core
→ ordinary npm project

DeepSeek Harness
→ external source checkout pinned to exact reviewed commit
→ verified by harness.lock.json + npm run doctor:harness
```

Workbench does not claim an npm distribution exists until that distribution is independently verified.

## What this pilot does not prove yet

- DeepSeek Harness has not yet executed a Family Space code mutation through Workbench.
- AAOP Route/Working Contract state is not yet wired into a live Workbench session.
- Cross-session durable continuation has not been pressure-tested, so LoopX remains unselected.

## Next frontier

Use this repository-frontier primitive as the first admission check in the `development-aaop` Domain Pack, then connect a real Harness session so one safely scoped Work Unit can execute through AAOP and return repository/test evidence.
