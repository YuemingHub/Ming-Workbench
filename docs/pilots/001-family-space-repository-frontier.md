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

A development Work Unit must not claim that a repository mutation is safe until its intended file surface is known and compared against current active repository work.

Decision contract for **execution**:

```text
intended file surface unknown
→ scope-required

known surface overlaps active work
→ conflict
→ narrow / reroute / handoff before implementation

known surface does not overlap active work
→ safe to proceed to the next execution gate
```

This is a repository-frontier check, not a replacement for AAOP. AAOP remains authoritative for Developer Intake, Route, Working Contract, authorization, Task Pod ownership and final engineering acceptance.

## Implemented delta

`src/domain-packs/repository-frontier.ts` provides:

- `RepositoryFrontier`
- `ActiveWorkItem`
- occupied-file collection
- `assessRepositoryFrontier()`
- explicit `safe | conflict | scope-required` outcomes

The primitive deliberately refuses to infer execution safety when intended files are unknown.

## Subsequent correction: do not block Developer Intake

The first integration pass placed this check before Workbench handed the request to AAOP. That was too early.

A normal user often cannot know which files need to change; discovering that surface is part of grounded Developer Intake. If `scope-required` blocked Intake itself, Workbench would force the human to understand the codebase before AAOP was allowed to inspect it.

The corrected order is:

```text
ordinary-language goal
→ read-only AAOP Developer Intake
→ proposed exact mutation scope
→ fresh repository-frontier check
→ only then may write execution continue
```

Conflict/unknown-scope evidence observed during Intake remains useful context. It may cause AAOP to narrow, reroute or wait, but it does not prevent read-only reasoning.

Even a `safe` frontier observed during Intake must be re-read immediately before mutation because active work may have changed in the meantime.

## Verification

The original local pilot verification was:

```text
tsc --noEmit
PASS

node --test test/*.test.mjs
5 tests
5 passed
0 failed
```

It proved:

1. unknown file scope does not become a false-safe execution decision;
2. `DialoguePage.tsx` collides with PR #268;
3. `ai-engine-core.js` reports both PR #267 and #268 as owners;
4. an unrelated `docs/evals/workbench-pilot.md` slice is allowed;
5. Work Unit completion still fails until an acceptance criterion carries recorded evidence.

Later tests additionally lock the corrected two-stage rule: unknown/conflicting scope may enter read-only AAOP Intake, while the hard pre-execution frontier still fails closed.

## CI found and corrected a separate false assumption

The first GitHub CI run failed before typecheck because Workbench declared `@deepseek-ai/dsh@0.1.0-rc.5` as an npm dependency. The upstream source checkout reported that package version, but the registry path returned:

```text
npm ERR! code ETARGET
No matching version found for @deepseek-ai/dsh@0.1.0-rc.5
```

This was treated as integration evidence, not hidden or bypassed.

The corrected boundary is:

```text
Workbench core
→ ordinary npm project

DeepSeek Harness
→ external source checkout pinned to exact reviewed commit
→ verified by harness.lock.json + doctor/hosted upstream smoke
```

Workbench does not claim an npm distribution exists until that distribution is independently verified.

## What this pilot still does not prove

- DeepSeek Harness has not yet executed a real Family Space repository mutation through Workbench.
- grounded AAOP Developer Intake has not yet been driven end-to-end from one ordinary-language Workbench command.
- cross-session durable continuation has not been pressure-tested, so LoopX remains unselected.

## Next frontier

Use the corrected two-stage boundary to drive an ordinary-language request into a read-only AAOP coordinator, obtain a bounded exact mutation scope, re-read Family Space's current active work, and only then issue a write-authorized Provider Execution Grant.