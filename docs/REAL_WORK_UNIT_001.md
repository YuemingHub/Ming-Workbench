# REAL WORK UNIT 001 — Family Space AAOP bridge 无法 ready（`production@` 声明缺失）

> 状态：**候选（候选锁定，等待 owner 提供真实 provider 凭据 + 生产基线裁决）**
> 记录：2026-08-15（Ming-Workbench branch `agent/execution-run-p1`，commit `11e65b2`）

## 一句话

Family Space 生产 HEAD 上，本地 AAOP 接入命令 `node scripts/aaop-family.cjs status`（以及 `ready` / `setup`）全部退出码 2，根因是 `CURRENT_STATE.md` 缺少 `production@<40-hex-sha>` 声明；这是「入口级」阻塞——不修它，任何开发者/Agent 都无法本地接入 AAOP。

## 证据（现实 readback，非 Agent 自述）

- `node scripts/aaop-family.cjs status` → exit 2，stderr：
  `Family-Space AAOP: CURRENT_STATE must declare a current product observation as production@<40-hex-sha>.`
- `grep -c "production@" CURRENT_STATE.md` → `0`
- 契约脚本 `scripts/aaop-family.cjs` 的 `extractDeclaredBaseline()`（正则 `/production@([0-9a-f]{40})/i`）在 `CURRENT_STATE.md` 中无匹配。
- `scripts/aaop-family.cjs setup` 同样先走 `validateCurrentProjectContract()`，被同一 gate 卡死（`.aaop/` 当前不存在，无法安装本地 AAOP）。

## 精确修复规格（已逐项核验，单行修复）

`validateCurrentProjectContract()` 会顺序校验 7 组、共 40 个 marker，其中 **39 个已全部就位**，唯一缺失的就是 `production@<40-hex-sha>` 声明：

| 组 | 就位 | 缺失 |
|---|---|---|
| CURRENT_PROJECT_STATUS（7 marker） | 7/7 | — |
| LIFE_VALIDATION_ROADMAP（9 marker） | 9/9 | — |
| REAL_PARENT_STRESS_TEST_PROTOCOL（4 marker） | 4/4 | — |
| **CURRENT_STATE baseline（`production@<40-hex>`）** | **0/1** | **1（仅此一项）** |
| CURRENT_STATE（5 marker） | 5/5 | — |
| AGENTS（4 marker） | 4/4 | — |
| AAOP project profile（6 marker） | 6/6 | — |

**修复 = 在 `CURRENT_STATE.md` 增加一行形如 `production@<40-hex-sha>` 的声明**（正则不区分大小写，任何 40 位十六进制均可通过语法 gate）。

## 验收标准（acceptance criteria）

1. `node scripts/aaop-family.cjs status` 退出码回到 **0**，且输出 `declared product observation: <40-hex>`。
2. 随后 `node scripts/aaop-family.cjs setup` 可正常安装固定 AAOP `0.20.1`（`22bc5f7d…`），`ready` 全绿。
3. 真实 `git HEAD` 无未授权变更（修复只落在 `CURRENT_STATE.md` 单文件，其余零污染）。

## 需要人类裁决的部分（不可由 Agent 擅自决定）

`production@<40-hex-sha>` 中的 SHA 必须是**所有者已核验的当前生产基线**，不是 Agent 从 `git ls-remote` 猜的：

- 候选值：GitHub `production` 分支 HEAD = `3aec7ea47230c2c8b447178ea8238947ccbd748e`（commit `docs(state): record parent repair deployment`）。
- 但 `CURRENT_STATE.md` 自述「服务器底层 checkout 仍是历史 detached 脏工作区，本轮按备份后的精确三文件更新完成」，即**真实运行 revision 未必等于任何干净 git SHA**。因此声明哪个 SHA 属于产品裁决，须由所有者确认。

## 为什么值得作为第一个真实 Work Unit

- **真实、可复现、入口级**：一次 `status` 调用即可复现，且阻断所有本地 AAOP 接入。
- **最小、可验证**：单行修复 + 明确的退出码验收标准，天然是「Agent 输出 ≠ Outcome」的最严考核样本（必须 status=0 才算完成，自述不算）。
- **暴露唯一剩余 human blocker**：修复动作本身需要 Workbench 的 `intake → authorize → execute` 真实链路，而 execute 目前 fail-closed 402 `provider-required`（无 `DEEPSEEK_API_KEY`），正好把「真实 provider 凭据」作为最后一项人类输入暴露出来。

## 无凭据期间已就绪的前置工作

- `scripts/smoke-family-space.mjs`（16 项全绿）：grounding + RED 状态固化（断言 status exit 2、authorize 冻结 `exact(1 path)` `CURRENT_STATE.md`、execute 无凭据 402、真实 HEAD 零污染）。
- 本规格文档：修复面、验收标准、需裁决项均已锁定，凭据就绪后可直接由 Workbench authorize gate 执行最小修复并验证。
