# DeepSeek Harness setup for Ming Workbench

Ming Workbench currently treats DeepSeek Harness as an external runtime pinned to the exact source revision in `harness.lock.json`.

## 1. Prepare the reviewed Harness checkout

Use a separate checkout of `deepseek-ai/deepseek-harness` at:

```text
47f943859bef60e4160492346772ded9b24f765a
```

Install and build that checkout using the upstream source instructions.

Do not replace this revision merely because a newer Developer Preview commit exists. Upgrade the Workbench pin only after compatibility evidence is recorded.

## 2. Verify the checkout from Workbench

Set `MING_HARNESS_CHECKOUT` to the absolute path of that source checkout.

macOS/Linux:

```bash
export MING_HARNESS_CHECKOUT=/absolute/path/to/deepseek-harness
npm run doctor:harness
```

PowerShell:

```powershell
$env:MING_HARNESS_CHECKOUT = 'C:\path\to\deepseek-harness'
npm run doctor:harness
```

The doctor verifies both the exact Git SHA and the source package version.

## 3. Expose the Workbench preset root

Set `MING_WORKBENCH_ROOT` to the absolute path of this repository.

macOS/Linux:

```bash
export MING_WORKBENCH_ROOT=/absolute/path/to/Ming-Workbench
```

PowerShell:

```powershell
$env:MING_WORKBENCH_ROOT = 'C:\path\to\Ming-Workbench'
```

## 4. Start Harness with the Workbench overlay

From the reviewed Harness source checkout, use its normal source-run command and add the Workbench patch:

```bash
pnpm dsh web --patch /absolute/path/to/Ming-Workbench/harness/workbench.cordis.patch.yml
```

The patch makes `development-aaop` the default Agent Preset and adds `Ming-Workbench/harness/presets` as a preset root. It leaves Harness's own user preset root enabled.

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

A Harness preset controls what the execution Agent can do. It does not decide whether a Work Unit should exist, which AAOP Route applies, whether a protected effect is authorized, or whether the engineering outcome is accepted.

Harness/session completion is execution evidence only. Ming Workbench completion still requires recorded evidence linked to acceptance criteria.
