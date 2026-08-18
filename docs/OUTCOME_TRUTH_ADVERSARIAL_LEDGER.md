# Outcome Truth & Security Adversarial Ledger

Adversarial verification lane for **Issue #32** — prevent false completion.

Not a feature lane. Everything below attacks the claim *"the product works"* on
the evidence actually present.

## Tracked target

- PR #29: `Stage 3 — Execution Bridge (confirmed agreement → real outcome)`
  - Branch `agent/stage3-execution-bridge-v1`
  - **Audited exact head: `fff0424cf3373d6bcac573d5865490334f773d23`**
  - State: `draft`, open, `mergeable_state=clean`, 5/5 GitHub check-runs green
- Issue #32: open, mission read in full.

## Reproducibility

```
# readonly, scans the pinned SHA via git (never the dirty working tree)
node scripts/adversarial/static-audit.mjs \
  --target-sha fff0424cf3373d6bcac573d5865490334f773d23 \
  --expect-sha fff0424cf3373d6bcac573d5865490334f773d23
```

## Verdicts at fff0424c

| ID | Verdict | Invariant |
|----|---------|-----------|
| E00 | PASS | audit bound to the pinned PR head |
| E10 | PASS | no credential-shaped literal in tracked source (`src`, `scripts`, `test`, `desktop`) |
| E11 | **PARTIAL** | fixture / real-provider separation IS labelled, but the whole slice content is scripted by the deterministic fixture ⇒ transport rehearsal, not content truth |
| E12 | PASS | projection returns `completed` only when verification `passed` AND acceptance `accepted`; else `partial`/`not_proven`/`failed` — no false `completed` from agent/driver report |
| E13 | **PARTIAL** | `projectOutcomeFromRun` maps `verification=passed + acceptance=rejected` to `partial` (overwrites the rejection). Latent today: `deriveRunOutcome` only emits `rejected` paired with verification `failed`, so a new outcome producer could re-open this. |
| E14 | PASS | browser journey fails closed on non-Linux (no xvfb) — cannot fake a browser PASS; advertised determinism is Linux-scoped |

Result: `PASS=4  PARTIAL=2  FAIL=0`.

## Findings (evidence-bound to fff0424c)

### F1 — E11: "first-real-outcome" is a transport rehearsal, not content truth
`scripts/stage3-fixture-server.mjs` is a **deterministic scripted server** that
emits the exact tool calls and the exact final `index.html` payload. Everything
downstream (write → delta → repository readback → browser display) validates
the fixture's own canned content.
- The scratch workspace has **no test command**, so in
  `src/execution/run-outcome.ts` the final branch yields
  `verification = 'passed'` from **repository readback only**, not from any
  test. The slice's summary `verification: passed` is therefore *"the fixture's
  expected write landed"*, not *"the outcome is independently verified"*.
- A regression in agent/reasoning cannot be caught; the fixture always emits
  exactly the right write.
- **This does not prove a real provider/agent produces an outcome.** The PR is
  honest that `REAL PAID PROVIDER: NOT RUN` and labels it a deterministic L3
  rehearsal — the discrepancy is that the headline and vertical-slice summary
  read as stronger ("first-real-outcome", `verification=passed`).
- Recommended correction: label the slice verdict `readback: passed` /
  `content: scripted` and never present fixture-readback `passed` as test
  verification.

### F2 — E13: rejection can be overwritten by optimism (latent)
`src/outcome/project-outcome.ts` final branch returns `partial`
("还差你亲自验收") for every non-`accepted` acceptance, including
explicitly `rejected`.
- Expected: a rejected-but-passed run should surface `rejected` (or `failed`),
  never "awaiting acceptance".
- Today unreachable because `deriveRunOutcome` sets `rejected` only with
  `verification: failed` (then projection returns `failed`). Report as a
  hardening defect for PR #29: add an explicit `acceptance === 'rejected'`
  branch in `projectOutcomeFromRun`.

### F3 — E14: "deterministic 21 PASS" is Linux-only
`stage3-first-outcome-slice.mjs` step 9 runs the real-browser check only on
Linux with `xvfb-run`; on any other OS it logs `SKIP` and `failures += 1`, so
the slice **exits non-zero**. The PR's "two fresh runs both exit 0 … 21 PASS /
0 FAIL / 0 SKIP" therefore holds only on Linux CI. On the actual desktop target
(Windows, per PR #28) this evidence is not reproducible from this repo state.

### F4 — working HEAD drift / concurrency (tracking note)
- The audited PR remote head is `fff0424c`.
- Local working checkout received an unpushed local commit `49e23a3`
  ("Feat: first-outcome executor + human-first Confirm->Execute bridge …"
  credential-scan PASS), captured onto the adversarial branch by a **concurrent
  developer agent** committing in the shared working directory in real time.
  Preserved under ref `preserve/concurrent-wip-49e23a3`.
- Adversarial discipline: never audit the dirty working tree or an unpushed
  concurrent commit as "PR #29". Re-bind every run to the remote PR head via
  `--target-sha`.

## Not proven (requires Linux/harness/installed-CD runtime)

- Whether `DEEPSEEK_API_KEY` (set to the fixture key at
  `scripts/stage3-first-outcome-slice.mjs`) persists anywhere the harness
  writes (Idea Space / Work Unit / Evidence / session ledger / argv). Env
  allowlist at `src/transports/harness-acp.ts` passes only
  `DEEPSEEK_API_KEY`/`DEEPSEEK_BASE_URL` through, which is correct; a runtime
  session inspection is still required.
- Real paid provider path (explicitly not run).
- Installed-consumer journey on the target OS (Windows).

## Gate status

Founder Alpha cannot pass this lane until:
1. F1 is corrected (readback vs test verified labeling, content-truth claim
   removed from the summary).
2. F2 (rejection branch) is either proved unreachable end-to-end or fixed.
3. A real-provider and/or installed-journey on the target OS exists for the
   remaining "real outcome" claim.

No false `completed` path was found at fff0424c (E12 PASS). Security scan is
green (E10 PASS).