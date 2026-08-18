# FOUNDER KILL TEST

**Purpose.** Prove or disprove that Ming Workbench earns its place next to
mature external stacks on a *real, unknown founder idea*. This is not a
benchmark of codegen quality — it is a test of the **intent → usable result**
loop. We run it to be told we are unnecessary, and we record the result
honestly.

**Owner.** External Reuse & Kill Test Agent (Issue #31). Neutral observer; not
a Ming advocate.

**Trigger gate (do not run early).** Only run after Ming has a **real installed
product path** with real provider-backed execution and independent evidence
readback (L3/L4 per `AGENTS.md`). A simulated / direct / scripted path does not
qualify — a loss on a non-real path proves nothing, and a win on a non-real path
is a false claim.

---

## The test

One real founder with one **unknown real idea** (their own, not a prepared
benchmark, not already built). The same idea, the same human, the same day, is
run through three stacks, independently, by the same neutral observer.

| Arm | Stack | Notes |
|---|---|---|
| A — Ming | Ming Workbench installed product path: human-first entry → confirmed agreement → execution bridge → executor → outcome projection → evidence readback | The whole product loop the human actually walks. |
| B — App Builder | Dyad (primary, local-first + BYOK) or bolt.diy | The prompt → runnable app slice. |
| C — Agent + Spec | Cline / OpenHands / goose + GitHub Spec Kit or OpenSpec | The developer agent + spec route. |

Each arm starts from the raw idea with **no coaching**. The observer records,
does not help. The human may freely use each tool the way they would alone.

---

## Measured axes

Every axis is scored from observed reality, never from model/tool self-report.

| Axis | Definition | Evidence required |
|---|---|---|
| **time to usable result** | Wall-clock from idea given to first *usable* artifact (runs, human can actually use it) | Timestamps; what "usable" means per arm, recorded before the run |
| **human interventions** | Every human action required beyond the first prompt (clicks, approvals, rewrites, bug reports, tech setup) | Logged count + each intervention's reason |
| **technical decisions forced on user** | Choices the non-technical founder must make (stack, model, env vars, terminal, deployment, "which tool for what") | Count + who made them |
| **intent drift** | Difference between what the human agreed they wanted and what was actually built, at acceptance time | Recorded before-run intent vs after-run reality; observer's delta note |
| **false-completed claims** | Times the stack said "done" but independent check showed otherwise (doesn't run, missing core behavior, tests red) | Independent check per "done" claim |
| **actual usable result** | Final artifact judged usable by the human + observer, independently | Artifact + independent check |
| **second-round continuity** | Same idea, next day: can the human reopen and continue (state, context, agreement, provider) without restarting | Reopen session evidence |
| **observable cost** | Real money + human time spent, itemized | Receipts / session logs |

---

## Scoring rule

Each arm gets a one-page scored sheet. Then one question:

> Did any external arm (B or C) reach a usable result with **no more** human
> interventions, **no more** intent drift, and **no more** false-completed
> claims than Ming (A)?

- If **yes** → Ming did not earn that round. Verdict `REPLACE` (adopt that arm
  as the execution slice behind the `SoftwareExecutor` seam) or `INTEGRATE`
  (call that arm through CLI/ACP/MCP/adapter) for the losing capability. Do not
  keep Ming code just because it exists.
- If **no** → Ming's intent layer earned that round. Verdict `KEEP`, with the
  specific owned capability named (per `EXTERNAL_REUSE_LEDGER.md`).
- **Not proven** is always a valid outcome. If no arm reached a usable result,
  the round is inconclusive — record why, do not award a win.

Only a result with independent evidence counts. A "Ming passed" claim without a
real installed-path run is a false-completed claim and fails the test by
definition.

---

## Anti-failure rules (how not to rig it)

- The observer is neutral and may recommend `KILL`/`REPLACE` for Ming.
- The idea is the founder's own and unknown to the observer beforehand.
- Each arm is judged on the same axes, same definition of "usable", recorded
  *before* the run starts.
- No arm receives coaching beyond its normal public documentation.
- A stack that requires the founder to learn a terminal, pick a stack, or edit
  code scores those as forced technical decisions — this is the point, not an
  excuse.
- Second-round continuity is tested by **closing and reopening**, not by
  navigating around state loss.

---

## Run record

| Round | Date | Idea | Arm A (Ming) | Arm B (builder) | Arm C (agent+spec) | Observer verdict | Action |
|---|---|---|---|---|---|---|---|
| — | — | — | — | — | — | — | — |
