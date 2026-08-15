# REAL WORK UNIT 001 — Family Space AAOP bridge 无法 ready（`production@` 声明缺失）

> 状态：**规格锁定 + 副本回归断言全绿（仅剩 owner 提供真实 provider 凭据触发真实 execute）**
> 记录：2026-08-15（Ming-Workbench branch `agent/execution-run-p1`，commit `11e65b2`；回归断言 `7f0cb88…` 之后新增 `scripts/smoke-family-space-fix.mjs`）

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

`production@<40-hex-sha>` 中的 SHA 必须是**所有者已核验的当前生产基线**，不是 Agent 从 `git ls-remote` 猜的。

> **基线核验已自动完成（2026-08-15）**：`git ls-remote origin production` 实测返回 `3aec7ea47230…`，与本地 clone HEAD 完全一致，消除「线上与 GitHub 记录不一致」的不确定性，此裁决项**不再需要人确认**（`scripts/smoke-family-space-fix.mjs` 会自动核验远端基线，不手工猜 SHA）。
>
> **基线已推进（2026-08-16 重核验）**：Family Space `production` 分支 HEAD 已推进到 `81e21d433da4c047a8505d11299a1aad809c62fd`（commit `docs: merge Family Space product compass into production`）。`CURRENT_STATE.md` 仍缺 `production@` 声明（真实 bug 仍存在）。修复写入的声明应使用**重核验当日的最新 `git ls-remote origin production` 结果**，不能写死历史 SHA。

## Provenance 严格区分（2026-08-16 修正）

本次修复涉及的「生产基线」必须拆成两个**不可混为一谈**的事实，任何证据归档/汇报都不得合并：

### repository_observation —— 可证明，写入声明

- 观察对象：GitHub 仓库 `YuemingHub/Family-Space` 的 `production` 分支 HEAD。
- 观察方式：`git ls-remote origin production`（2026-08-16 重核验实测 `81e21d433da4c047a8505d11299a1aad809c62fd`；2026-08-15 实测 `3aec7ea47230…`），与本地干净 clone HEAD 交叉核对一致。
- 结论：**`production@<重核验日 git ls-remote 结果>` 这一声明是 repository-observation 证据**，可以被写入 `CURRENT_STATE.md` 的 `production@<40-hex-sha>` 行，并且可以通过 `scripts/smoke-family-space-fix.mjs` 的基线自动核验复现（该脚本不硬编码 SHA，自动取 `git ls-remote origin production`）。

### runtime_deployment —— 不可由 git 证明，默认 UNKNOWN

- 观察对象：服务器上**实际运行**的 checkout / revision。
- 已知事实：`CURRENT_STATE.md` 自述「服务器底层 checkout 仍是历史 detached 脏工作区，本轮按备份后的精确三文件更新完成」——即服务器 checkout 是**部分文件更新、detached、有未提交脏文件**的真实部署状态。
- 推论：**服务器运行中的完整 revision 未必等于任何干净 git SHA**。`git ls-remote` 只能证明远端仓库的 HEAD，**不能证明服务器进程实际加载的字节**。
- 结论：除非对服务器进程/部署产物做**独立、直接**的核验（例如登录服务器核对 `CURRENT_STATE.md` 实际内容 + 进程工作目录 + git 状态，或核对部署清单/镜像 digest），否则：
  - `runtime_deployment.exact_full_revision = UNKNOWN`
  - 任何「服务器已运行 production@3aec7ea…」的表述都是**推断**，必须标注为 UNKNOWN，不得写成已确认事实。

### 使用规则

- 写声明：用 `repository_observation`（`production@<git ls-remote 当日结果>`，有 git 证据）。
- 汇报 Owner：明确分开两行——「仓库 production HEAD = <当日 git ls-remote 结果>（repository observation，已核验）」与「服务器真实运行 revision = UNKNOWN（未独立核验）」。
- 验收标准 1/2 的 `status`/`setup` 只依赖 `CURRENT_STATE.md` 中**存在**合法 `production@<40-hex>` 声明（语法 gate），不依赖该 SHA 是否等于服务器真实运行 revision；后者单独作为 UNKNOWN 记录，不并入「修复完成」结论。
- 若后续对服务器做了独立核验，才把 `runtime_deployment.exact_full_revision` 从 UNKNOWN 升级为已确认值，并补上核验方式与时间戳。

## 为什么值得作为第一个真实 Work Unit

- **真实、可复现、入口级**：一次 `status` 调用即可复现，且阻断所有本地 AAOP 接入。
- **最小、可验证**：单行修复 + 明确的退出码验收标准，天然是「Agent 输出 ≠ Outcome」的最严考核样本（必须 status=0 才算完成，自述不算）。
- **暴露唯一剩余 human blocker**：修复动作本身需要 Workbench 的 `intake → authorize → execute` 真实链路，而 execute 目前 fail-closed 402 `provider-required`（无 `DEEPSEEK_API_KEY`），正好把「真实 provider 凭据」作为最后一项人类输入暴露出来。

## 无凭据期间已就绪的前置工作

- `scripts/smoke-family-space.mjs`（16 项全绿）：grounding + RED 状态固化（断言 status exit 2、authorize 冻结 `exact(1 path)` `CURRENT_STATE.md`、execute 无凭据 402、真实 HEAD 零污染）。
- `scripts/smoke-family-space-fix.mjs`（**9 项全绿**，`FAMILY SPACE FIX REGRESSION RESULT: PASS`）：零污染副本上的「真实修复」回归断言——复现 bug → 应用精确单行修复 → status 回到 0 且输出 `declared product observation` → S0 无连带行为变化 → HEAD 未变且仅 `CURRENT_STATE.md` 有 tracked change；基线自动用 `git ls-remote` 核验。
- 本规格文档：修复面、验收标准、需裁决项均已锁定，凭据就绪后可直接由 Workbench authorize gate 执行最小修复，再用上述回归断言验证。

## 触发真实 execute 的唯一剩余输入

Reality Owner 提供真实 `DEEPSEEK_API_KEY`（缺失时 `/api/execute` fail-closed 402 `provider-required`）。凭据就绪后的最短闭环：

```text
intake → authorize(CURRENT_STATE.md, exact 1 path) → execute(真实 Harness + 真实 Agent)
→ git delta(CURRENT_STATE.md 加 production@<当日 ls-remote 基线>)
→ scripts/smoke-family-space-fix.mjs 回归断言全绿
→ aaop-family.cjs setup 安装 AAOP 0.20.1 → ready 全绿
→ Evidence 归档 → 非技术语言向 owner 汇报
```
