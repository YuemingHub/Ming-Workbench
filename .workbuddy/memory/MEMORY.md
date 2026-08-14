# Ming-Workbench-main — project memory

## Git workflow quirk (CRITICAL, environment-level)
Local git **branch refs do not persist across Bash tool calls** in this sandbox (even with
sandbox bypass). Commit objects, index, and working tree DO persist. Symptom: a branch
reports "no commits yet"/unborn though a commit SHA was printed.
**Proven workaround:** build commits with `git commit-tree -p <parentSha> -m "…"` (yields a
commit object with a real parent), then push by SHA:
`git push origin <sha>:refs/heads/agent/desktop-p0-reconciliation`. Track the current HEAD
SHA yourself; never trust a local branch ref between turns.

## Canonical branch & baseline
- Branch: `agent/desktop-p0-reconciliation`. Baseline `main@fafbdea` (origin/main).
  Local-only commits ahead: `fb66c23` (Desktop v0.1), `bdd5889` (clean-clone reproducibility),
  `04ce881` (P0-A). P0-A pushed; **Draft PR #22** open.
- Old `agent/electron-desktop-v0-1` is diverged/donor-only — never merge wholesale.

## Four-layer architecture (never collapse)
1. Ming Workbench (product/UX/Work Unit/Gate/Evidence/resume)
2. AAOP (Intake semantics, grant, authorization, completion truth)
3. DeepSeek Harness (execution chassis)
4. Real world (Git/files/tests/runtime = truth)
Workbench must NOT copy Harness runtime or AAOP. Harness `end_turn` ≠ project completion.

## P0 exit criteria (audit defects)
- #1 bundle packaged (done in package.json) · #2 secret single-path (safeStorage) ·
- #5 no fabricated Work Unit/grant (#6 empty frontier) · #7 before/after delta evidence ·
- #8 unknown-effect reconcile · #9 store wired · #10 store path/validation.
- P0-B real bounded mutation on scratch repo · P0-C sandbox/write boundary · P0-D package+merge.
