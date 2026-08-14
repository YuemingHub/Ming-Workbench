# DeepSeek Harness setup for Ming Workbench

Ming Workbench treats DeepSeek Harness as an external runtime pinned to the exact source revision in `harness.lock.json`.

## Normal setup

Requirements:

- Git
- Node `^22.19.0` or `>=24`
- network access to GitHub and the npm registry during preparation

From the Ming Workbench repository:

```bash
npm install
npm run harness:prepare
npm run doctor:harness
```

`harness:prepare`:

1. reads the reviewed repository, commit and source package version from `harness.lock.json`;
2. prepares `.workbench/vendor/deepseek-harness` at that exact commit;
3. refuses to replace an existing non-Git path;
4. refuses to mutate a dirty Harness checkout;
5. refuses an unexpected upstream `origin`;
6. installs the reviewed Harness workspace using `pnpm@11.7.0` through `npx` — no global pnpm installation is required;
7. verifies the exact Git SHA, source package version, and checkout-local `tsx` runner.

The managed checkout is ignored by Git and is not Workbench source state.

Do not replace the reviewed Harness revision merely because a newer Developer Preview commit exists. Upgrade `harness.lock.json` only after compatibility evidence is recorded.

## Bring your own Harness checkout

For Harness compatibility development or an intentionally separate checkout, set `MING_HARNESS_CHECKOUT` before preparing/verifying.

macOS/Linux:

```bash
export MING_HARNESS_CHECKOUT=/absolute/path/to/deepseek-harness
npm run harness:prepare
npm run doctor:harness
```

PowerShell:

```powershell
$env:MING_HARNESS_CHECKOUT = 'C:\path\to\deepseek-harness'
npm run harness:prepare
npm run doctor:harness
```

The same exact-revision and dirty-checkout protections apply.

## ACP automation path

Workbench's programmatic software-development transport uses the prepared checkout's own:

```text
node_modules/tsx/dist/cli.mjs
```

through the current Node executable. Runtime execution therefore does not require global `pnpm` or `tsx`.

The ACP path remains bounded by the AAOP Provider Execution Grant:

- `read-only` Grant → Harness read-only standing permission;
- write-authorized Grant → Harness workspace-write standing permission;
- exact repository/base/working ref is checked before model execution;
- same-turn permission widening is rejected;
- task-specific GitHub/cloud/database secrets are not inherited by the Harness child process.

## Interactive Web UI

Workbench also ships `harness/workbench.cordis.patch.yml` and a repository-owned `development-aaop` Agent Preset for interactive Harness Web use.

Set `MING_WORKBENCH_ROOT` to the absolute path of the Workbench repository, then start the reviewed Harness checkout with the Workbench patch using the upstream source-run command surface.

Example after preparation:

```bash
export MING_WORKBENCH_ROOT=/absolute/path/to/Ming-Workbench
cd .workbench/vendor/deepseek-harness
npx -y pnpm@11.7.0 dsh web --patch "$MING_WORKBENCH_ROOT/harness/workbench.cordis.patch.yml"
```

On PowerShell, use the corresponding absolute Windows path and environment-variable syntax.

The patch makes `development-aaop` the default Agent Preset and adds `Ming-Workbench/harness/presets` as a preset root. It leaves Harness's ordinary user preset root enabled.

## P0 development preset

`development-aaop` intentionally exposes one-agent execution only:

- repository instructions;
- sandboxed shell;
- filesystem + search;
- Skills;
- background job controls;
- compaction;
- ask-user;
- one in-progress todo;
- web search.

It intentionally does **not** expose:

- subagent tools;
- dynamic Workflow;
- Ralph;
- model-facing Harness Goal.

Those capabilities are not forbidden forever. They require a separate AAOP decision that proves a Task Pod/workflow capability gap, then a bounded preset/session can expose them deliberately.

## Authority boundary

A Harness preset or ACP session controls execution capability. It does not decide whether a Work Unit should exist, which AAOP Route applies, whether a protected effect is authorized, or whether the engineering outcome is accepted.

Harness/session completion is execution evidence only. Ming Workbench completion still requires recorded evidence linked to acceptance criteria and AAOP engineering acceptance.
