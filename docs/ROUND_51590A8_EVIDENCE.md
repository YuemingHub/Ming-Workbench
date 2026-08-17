# Review round evidence — candidate `51590a8` (P0.3 grounded scope + Windows fixes)

Candidate SHA: `51590a899692295e219fe4fc526c94c89042c7b7` (branch `desktop-productization`, PR #23).
Base: `052be098d9c318b534e365c5fdee22d2dfbc43a4`. Previous candidate: `8ed6a8b`.

## Test suite (exact head, local)

```
npm run check: PASS
npm test: 175 total / 173 pass / 0 fail / 2 skip
```

The 2 skips are `MING_HARNESS_TEST=1`-gated integration tests that require
network + the real bundle (CI-owned).

## B2 — execution failure restores non-running authority

`src/web/local-server.ts` `/api/execute` catch path now persists an
evidence-honest terminal state before returning the error:

- work unit transitions `running` -> `blocked`
- `nextFrontier` carries `执行未完成：<reason>`
- save is attempted even when the original execution threw

Regression: `test/p02-review-blockers.test.mjs` `B2: backend persists running
before execution and restores non-running on throw` asserts the `blocked`
restore + `执行未完成` copy. The renderer execution-authority IPC
(`desktop:work-unit-running`) was deleted from `desktop/main.mjs`,
`desktop/preload.cjs`, and `src/web/local-ui.ts`; the install gate reads the
backend Work Unit store only.

## B3 — grounded proposed scope (no keyword scoring)

`src/execution/scope-proposal.ts` rewritten per P0.3 grounding rule:

- candidates come ONLY from explicit repo-relative paths in:
  A. AAOP/Harness `project_evidence_summary`, B. coordinator `next_action`,
  C. a path the user typed in the raw request;
- every candidate must resolve against `git ls-files` and stay inside the
  repo root (no traversal, no absolute/drive path, no protected dir);
- empty proposal fails closed: normal UI remains read-only;
- the normal-user whole-repository option is removed (UI, API, tests);
- `src/intake/coordinator.ts` prompt now asks `project_evidence_summary` to
  name implementation files with exact repo-relative paths when evidence
  supports them (canonical envelope schema unchanged);
- `src/web/local-ui.ts` renders proposed paths with `createElement` +
  `textContent`, never `innerHTML` concatenation.

Regressions: `test/p02-review-blockers.test.mjs` (grounded extraction,
user-typed path, fail-closed, traversal/absolute/protected rejection, safe
rendering, no whole-repo option).

## B5 — real two-launch resume proof (live, packaged exe)

`scripts/b5-resume-proof.ps1` runs the actual packaged app twice with a fresh
`--user-data-dir`; state is written by the app, never seeded manually:

```
LAUNCH 1 (--project scratch, fresh userData)
  backend ready -> state file exists -> lastProject == scratch
  FIRST_RUN_STATE_WRITTEN_BY_APP: true
  clean close, residual=0: PASS
LAUNCH 2 (same userData, no --project)
  backend ready -> project fixed <scratch> -> SECOND_RUN_AUTO_RESTORE: PASS
  clean close, residual=0: PASS
B5_REAL_RESUME: PASS
```

## B6 — NSIS installed-app smoke

`scripts/desktop-windows-package-smoke.ps1` now performs the consumer
distribution proof: build NSIS -> silent per-user install into an isolated
dir -> verify installed exe / uninstaller / Desktop + Start Menu shortcuts ->
launch installed `Ming Workbench.exe` -> backend ready + HTTP 200 + request
token + Harness pin identity + `auto-updater loaded: NsisUpdater` -> clean
close / zero residual -> uninstall / cleanup. The win-unpacked diagnostic
smoke remains as a non-distribution check.

## Windows MAX_PATH fix (new in this candidate)

`src/hosts/harness-runtime.ts` extracts the bundled Harness runtime under a
short per-user cache (`os.tmpdir()/ming-workbench-harness`,
`MING_HARNESS_CACHE` override) instead of the packaged app's deep
`resources/app/...` path, which pushed pnpm's `.pnpm` store past the 260-char
limit and broke extraction (`ERROR 3` in robocopy / native install failures).
Tests use a hermetic per-test cache so the missing-bundle path stays
independent of leftover extractions.

## B7 — release workflow

`.github/workflows/release.yml` content is recorded in `docs/RELEASE_PIPELINE.md`
+ `docs/release-workflow.yml`. The push credential lacks the GitHub `workflow`
scope required to write `.github/workflows/`; Total Review adds it to the PR
branch via the GitHub connector after the smoke contract is accepted (per PR
body). Local copy kept at `.github/workflows/release.yml` (untracked).

## Still not claimed

- No tag / GitHub Release.
- Auto-update E2E (needs two real releases).
- Packaged live provider execution (final internal-alpha dogfood gate).
