# Zcode 轮次日志

> 每轮工作结束时追加一条摘要，供下一轮快速恢复上下文：本轮做了什么、遇到什么问题、有哪些弯路、有哪些好经验。不覆盖历史。

## 2026-08-15 轮次 1 — P1-1 ExecutionRun 完成并提交推送

### 做了什么
- 实现一等对象 `ExecutionRun`（`src/execution/execution-run.ts`）：id/workUnitId/authorizationRef/runtime/provider/model/sessionId/status/startedAt/finishedAt/outcome/evidenceRefs；open/closeExecutionRun；每次授权尝试都是新 run。
- store v1→v2 迁移：`src/persistence/work-unit-store.ts` 新增 `runs` 字段；`file-work-unit-store.ts` 接受 v1/v2（v1 读为空 runs，未知新版本 fail-closed 视为空）；`desktop/work-unit-store.mjs` STORE_VERSION 同步 1→2。
- `src/web/local-server.ts` 新增只读 `GET /api/runs?workUnitId=`；`/api/execute` 改为 open→run→close→持久化 run，失败 fail-closed 记 failed run，响应带 `runId`。
- 新增 `test/execution-run.test.mjs`（6 项：store 迁移 / run 生命周期 / /api/runs 端点 / 真实 authorize→execute 写边界阻断记录 failed run）。
- 增强 `scripts/smoke-desktop-scratch-mutation.mjs`：execute 产生唯一 run 且绑定 grant；重启后 run 持久化且 identity 不变；重授权产生第二个新 run。
- 更新 plan 文档进度账本，提交 `40fcd02` 并 push 分支 `agent/execution-run-p1`（从 P0 分支切出，未污染 PR #22）。

### 验证证据
- FTS 全量 157 pass / 0 fail / 2 skip。
- `SCRATCH MUTATION RESULT: PASS`：真实 reviewed Harness + mock LLM + 真实 scratch Git repo。

### 遇到的问题
- 无阻塞问题。此前 P0-4 仍被 GitHub `workflow` scope 拒绝（HUMAN_AUTHORIZATION_REQUIRED），等待 owner 执行 `gh auth refresh -s workflow`。

### 弯路
- 无重大弯路。P1-1 设计提前明确了"run 只做 Session 指针 + 四轴 outcome + 证据引用，不重实现授权/grant 语义"，避免了膨胀。

### 好经验
- 在独立分支做 P1 工作（`agent/execution-run-p1`），避免污染 P0 的 PR #22 merge scope，推送后远程也可恢复。
- 增强 scratch smoke 而不是新建 smoke，复用既有真实入口证明 P1-1 持久化语义，比纯单测更有说服力。
- store 迁移采用"仅 v1→v2 前向迁移 + 未知版本 fail-closed"，可逆且安全。

### 下一轮入口
- 按 plan P1-2 ExecutionFingerprint：为每个 Run 记录可重建的执行身份（Harness SHA / profile digest / provider+model / permission preset / sandbox mode / repo+baseRef / config digest），目标半年后能回答"结果由什么运行环境产生"。

## 2026-08-15 轮次 2 — P1-2 ExecutionFingerprint 完成，P1-3 待启动

### 做了什么
- 新增 `src/execution/execution-fingerprint.ts`：`buildExecutionFingerprint()` 实时采集 run 可重建身份（harness version/commit 实读 checkout、profile id+digest、provider/model、permission preset、sandbox mode、workspace repository/baseRef、workbenchConfigDigest）+ `sameExecutionFingerprint()` 对比函数。
- `ExecutionRun` 与 `PersistedExecutionRun` 增加 `fingerprint?`，`/api/runs` 暴露；execute handler best-effort 采集（失败不得吞掉 run 记录）。
- 新增 4 项 P1-2 单元测试；增强 scratch smoke 的 P1-2 断言。
- 更新账本与轮次日志。

### 验证证据
- FTS 全量 161 pass / 0 fail / 2 skip。
- `SCRATCH MUTATION RESULT: PASS`（真实 Harness + mock LLM + 真实 scratch Git repo），新增 P1-2 断言全过：run fingerprint 记录 `0.1.0-rc.5` / `47f94385` / profile digest / provider/model / `workspace-write` / baseRef。

### 遇到的问题与弯路
- **弯路**：最初 fingerprint 直接在 `openExecutionRun` 参数中求值，scratch 测试环境的 harnessCheckout 路径无效时 `buildExecutionFingerprint` 抛异常，导致 run 记录根本没创建（断言 1 个 run 却得到 0，FTS 一度 fail 1）。根因是"辅助身份采集阻塞了主记录写入"。
- **修复经验**：改成 best-effort 采集（try/catch → undefined）。原则：指纹是身份证据，不是授权输入；身份采集失败可以缺失，绝不能阻止 failed run 落盘（fail-closed 的"记录失败"语义仍成立）。

### 好经验
- P1-2 严格按文档"不复制大配置，只保存 identity + digest + pointer"，fingerprint 很小且可对比。
- 复用 `inspectHarnessCheckout` 实读 harness git HEAD，指纹是"实测"不是"假设"。
- 每轮先跑 FTS + scratch smoke 再提交，提交带 SHA 与账本更新，下一轮可精确恢复。

### 下一轮入口
- P1-3 Ming Evidence Spine：用现有 durable Harness Session Persistence/Query 投影证据（session pointer + exact event range/revision + digest + selected claims + provenance + model/provider identity + links to independent outcome evidence），能跳回 canonical Harness execution truth，不创建第二套 Harness 日志。
- 需要先读 `harness-acp.ts` / harness session 持久化现状，确认 Session Query API 形态。

## 2026-08-15 轮次 3 — P1-3 Ming Evidence Spine 完成并提交推送

### 做了什么
- 确认边界：Ming 是 Harness ACP client，无法 import Harness 内部 cordis 服务；但 `session-persistence-jsonl` 的 `format.ts`/`zstd.ts` 是纯函数（无 ctx 依赖），可通过 reviewed checkout 的 tsx CLI 运行。
- 新增 `harness/session/project-session.mjs`：用官方 `logPath/scanZstdFrames/createZstdFrameDecoder/scanLog` 只读 canonical `session.jsonl.zstd`，输出紧凑投影 JSON（pointer/header/revision/digest/frames/committedBytes/eventRange）。验证脚本曾因 `new URL('.', fileURL)` 上跳一级目录导致找不到包，修正为直接 `fileURLToPath`。
- 新增 `src/execution/evidence-spine.ts`：`EvidenceProjection` 类型 + `buildSessionEvidenceProjection()`（spawn tsx 跑投影脚本 + 校验 JSON，best-effort 失败返回 undefined，绝不吞 run 记录）。
- `ExecutionRun`/`PersistedExecutionRun` 增加 `projection?`，`closeExecutionRun` 接收 projection，`/api/runs` 暴露；execute handler 在 run 关闭时构建投影（有 sessionRoot 且有 sessionId 时）。
- 新增 `test/evidence-spine.test.mjs`（6 项，用 node:zlib 构造 canonical zstd 多帧产物，验证投影派生/round-trip/缺失场景 best-effort）；增强 scratch smoke 的 6 项 P1-3 断言。
- 更新账本与轮次日志。

### 验证证据
- FTS 全量 167 pass / 0 fail / 2 skip（新增 6 项 P1-3）。
- `SCRATCH MUTATION RESULT: PASS`（真实 Harness + mock LLM + 真实 scratch Git repo）：run projection 指向 `session.jsonl.zstd` + digest + revision/size + eventRange count=80 且 firstSeq=0 lastSeq=79。

### 遇到的问题与弯路
- **弯路**：投影脚本最初用 `new URL('.', pathToFileURL(harnessCheckout).href)` 构造官方源码路径，实际会解析成父目录导致 `ERR_MODULE_NOT_FOUND`；直接 `fileURLToPath(pathToFileURL(raw))` 即正确。
- **弯路**：直接 import `@deepseek-ai/dsh-session-persistence-jsonl` 包名在 Workbench 目录下无法解析（该包没有顶层 node_modules symlink）；改为从投影脚本内用绝对路径 import 官方 `src/format.ts`/`src/zstd.ts`，由 tsx + reviewed tsconfig 解析内部 `@deepseek-ai/dsh-*` 依赖，问题解决。

### 好经验
- "复用 Harness 官方读取"的正确形态 = 在 harness 侧写只读脚本 import 官方纯函数，而不是在 Ming 侧重写 zstd/JSONL。投影 JSON 由官方 format/zstd 代码产出，既跳回 canonical truth 又不复制事件日志。
- 多帧 zstd canonical 产物可用 node:zlib `zstdCompressSync`（checksumFlag）逐帧构造，供测试驱动真实投影脚本，避免依赖 /tmp 遗留产物。
- Evidence Projection 只保存 pointer + revision/digest + eventRange + header facts，是"指针"，不是"副本"，符合 plan 的最小切片。

### 下一轮入口
- P1-4 Independent Verifier Lane：Executor 改变现实后，Verifier 收到 goal + criteria，独立重读 repo/test/runtime/browser/API，不继承 Executor 结论，输出证据-backed 判定；偏好 separate session / read-only / 必要时不同 model-provider / 可调用真实 probes。
- P0-4 仍等 owner `gh auth refresh -s workflow` 激活 workflow 后合 PR #22。

## 2026-08-15 轮次 4 — 真实 Family Space 项目 grounding + 发现 REAL WORK UNIT 001 候选

### 做了什么
- 按长期总指令切换目标：不再继续扩建 P1-x 能力，直接进入「用 Ming-Workbench 跑通第一个真实项目 Family Space」。指令明确 Verifier v0 = Reality（不是第二个 Agent），且「No capability without pressure」，故 P1-4 第二 Agent Verifier 暂停。
- 浅克隆真实 `YuemingHub/Family-Space`（production `3aec7ea47230…`）到 `.workbench/projects/family-space`，并把 `.workbench/projects/` 加入 `.gitignore`（Family Space 是独立仓库，不得进入 Ming-Workbench git）。
- 新增 `scripts/smoke-family-space.mjs`：provider-free 的真实项目 grounding smoke，16 项断言全过。

### 验证证据
- **真实 bug（REAL WORK UNIT 001 候选）**：Family Space 生产 HEAD 上，`node scripts/aaop-family.cjs status` 退出码 2，stderr = `CURRENT_STATE must declare a current product observation as production@<40-hex-sha>.`（`grep -c "production@" CURRENT_STATE.md` = 0）。其自身 AAOP 桥接 `status`/`ready`/`setup` 全部因此失败，任何开发者/Agent 都无法本地接入 AAOP。
- **Workbench grounding 全链**：onboarding 经 `workbench.project.json` 识别真实项目（id `family-space`）→ read-only Intake 正确返回 `blocked` 并把真实 blocker 原文透出（不伪造进度）→ blocked Work Unit 持久化可 resume → authorize 在真实 repo 上冻结 `exact(1 path)` `CURRENT_STATE.md` + 绑定真实 repository/branch/base → execute 无 provider 凭据时 fail-closed 返回 402 `provider-required` → 真实 HEAD 未变（无未授权 mutation）。
- `FAMILY SPACE GROUNDING RESULT: PASS`（16/16）。
- FTS 全量 167 pass / 0 fail / 2 skip；`npm run check`（tsc --noEmit）通过。

### 遇到的问题与弯路
- **弯路（识别真实 bug 的过程）**：最初想跑 Family Space 单测找 RED，但 clone 无 node_modules，`axios` 缺失导致 `test-ai-assistant-identity` 等失败——那是缺依赖，不是产品 bug。转而直接跑其自身 AAOP 桥接脚本，才定位到确定性、可复现的契约破坏（CURRENT_STATE.md 缺 `production@<40-hex>`）。
- **弯路**：想用 `scripts/aaop-family.cjs setup` 安装 AAOP，被同一个契约 bug 卡死（`setup` 也先走 `validateCurrentProjectContract`）。这恰好证明该 bug 是「入口级」阻塞：不修它就根本无法本地接入。

### 精确修复规格（本轮追加核验）
- 逐项核验 `validateCurrentProjectContract()` 的 7 组 40 个 marker：**39/40 已就位，唯一缺失 = `CURRENT_STATE.md` 的 `production@<40-hex-sha>` 声明**。修复是单行变更，验收标准 = `node scripts/aaop-family.cjs status` 退出码回到 0。SHA 值本身（GitHub production HEAD=`3aec7ea…` 为候选，但真实运行 revision 须所有者核验）属产品裁决，写入 `docs/REAL_WORK_UNIT_001.md`。

### 好经验
- 用真实项目自身的确定性命令（`aaop-family.cjs status` 的退出码）作为「现实 readback」，比任何 mock 断言都硬。
- grounding smoke 故意 **provider-free**：Family Space 桥接在 coordinator 之前就 blocked，execute 无凭据必须 402，两者都不需要 mock LLM，反而把「唯一剩余 human blocker = 真实 provider 凭据」暴露得最干净。
- 不伪造进度：Intake 面对真实破损桥接返回 `blocked` 并透出真实原因，而不是凭空生成一个 grounded Work Unit——这正是「Agent output ≠ Outcome」的产品化体现。

### 下一轮入口（REAL WORK UNIT 001 的最终闭环）
1. **真实修复目标已锁定**：让 Family Space 的 `CURRENT_STATE.md` 重新声明 `production@<40-hex-sha>`（当前真实 production 基线），使 `node scripts/aaop-family.cjs status` 退出码回到 0。小、可验证、有产品意义（AAOP 本地接入恢复）。
2. **剩余 human blocker**：真实 provider 凭据（`DEEPSEEK_API_KEY`）。有凭据后，走 `intake → authorize(CURRENT_STATE.md) → execute(真实 Harness 真实 Agent) → git delta → aaop-family.cjs status=0 验证 → evidence → outcome`。
3. 无凭据期间可继续的无凭据工作：把 `scripts/aaop-family.cjs setup` 契约修复链路、以及「真实修复」的 regression（一个断言 status 退出码=0 的测试）预先准备好。

## 2026-08-15 轮次 5 — RWU001 生产基线自动核验 + 「真实修复」回归断言固化

### 做了什么
- **消除生产基线裁决不确定性**：用 `git ls-remote origin production` 实测远端 production HEAD = `3aec7ea47230c2c8b447178ea8238947ccbd748e`，与本地 clone HEAD 完全一致 → 「线上与 GitHub 记录不一致」的不确定性消除，RWU001 中原本标为「须所有者裁决」的 SHA 项不再需要人确认（回归 smoke 会自动核验远端基线，不手工猜 SHA）。
- **确认 mock LLM 无法驱动修改已存在文件**：读完 `llm-mock-server/src/index.ts` + `cli.ts`，确认 `tool_call_success` 只能带单一 `toolName`+`toolArguments`；配合 harness `workbench.cordis.yml` 启用的 `fs-observation-policy`（read-before-write），scratch smoke 也只能创建新文件（`app.js`）。RWU001 修复对象是**已存在**的 `CURRENT_STATE.md`，因此 mock 路径不足，**真实 provider 凭据是唯一硬阻塞**。
- **新增 `scripts/smoke-family-space-fix.mjs`（9 项回归断言）**：零污染副本（`cp -R --reflink=auto`）上：①复现真实 bug（status exit 2）→ ②在「当前仓库观察基线：」行加入 `production@<baseline>` → ③status 退出码回到 0 且打印 `declared product observation` → ④S0 无连带行为变化 → ⑤HEAD 未变且仅 `CURRENT_STATE.md` 有 tracked change。基线用 `git ls-remote` 自动检测并交叉核对本地 HEAD。
- 更新 `docs/REAL_WORK_UNIT_001.md`（状态改为「规格锁定 + 回归断言全绿，仅剩 owner 提供凭据」）、plan 账本、轮次日志。

### 验证证据
- `FAMILY SPACE FIX REGRESSION RESULT: PASS`（9/9），baseline `3aec7ea47230…`（`git ls-remote origin production == local HEAD`）。
- 修复前复制品 status exit=2（复现）；修复后 exit=0，输出 `declared product observation: 3aec7ea47230c2c8b447178ea8238947ccbd748e`、`life-validation stage: S0`。
- 零污染确认：副本 HEAD 不变，`--porcelain --untracked-files=no` 仅 `CURRENT_STATE.md` 一行。

### 遇到的问题与弯路
- **弯路**：`cp -R <src> <已存在目录>` 会把 src 复制成目标目录的子目录，导致副本路径错位；改为 `cp -R --reflink=auto <src>/. <copy>` 复制内容。
- **弯路**：`git status --porcelain` 输出经 `run()` 的 `.trim()` 处理后首字符空格被吃掉，`l.slice(3)` 切出 `URRENT_STATE.md`（丢首字符）；改用 `trimStart()` + 正则 `^\S\s+(.+)$` 解析路径，断言修复。

### 好经验
- 生产基线是**可自动消除**的裁决项：`git ls-remote` + 本地 HEAD 交叉核对即可，不必把可核验的事实上升为人的裁决。
- 回归断言固化为零污染副本 smoke，比在真实仓库上试更安全：修复规格的可验证性在凭据就绪前就能全绿，凭据一到即可直接触发真实 execute 并复用同一断言验收。

### 下一轮入口
- **唯一剩余 human blocker**：真实 provider 凭据 `DEEPSEEK_API_KEY`（缺失时 `/api/execute` fail-closed 402）。凭据就绪后走 `intake → authorize(CURRENT_STATE.md, exact 1 path) → execute(真实 Harness + 真实 Agent) → git delta → scripts/smoke-family-space-fix.mjs 回归断言全绿 → aaop-family.cjs setup(AAOP 0.20.1) → ready 全绿 → Evidence 归档 → 非技术语言向 owner 汇报`。
- P0-4 仍等 owner `gh auth refresh -s workflow` 激活 workflow 后合 PR #22。

## 2026-08-15 轮次 6 — P0 收口（PR #22）+ P1 基线对齐 + 真实压测全链验证

### 做了什么
- **P0-4 正式激活并跑绿**：当前凭据已具备 `workflow` scope（历史上缺失），`.github/workflows.dist/desktop-windows-package-smoke.yml` 移入 `.github/workflows/` 并 push；真实 `windows-latest` runner 对 exact head 全绿——win-unpacked + portable 真实启动、backend-ready、loopback HTTP 200 + token meta、harness identity 与 `harness.lock.json` 一致、零残留进程、secret sentinel 无泄漏（`desktop-windows-package-smoke` 全 PASS）。
- **修复真实 smoke 暴露的 bug**：electron >= 43 无 npm postinstall，干净 `npm install` 后 `node_modules/electron/dist` 为空，electron-builder 报 `electronDist does not exist`；`desktop-windows-package-smoke.ps1` 构建前运行仓库自带 `node_modules/electron/install.js`（幂等）确保二进制就绪，workflow 保持薄 runner。
- **PR #22 evidence truth 已 reconcile**：PR body 的 exact SHA（旧 `68fc789` → 真实 head）、CI 证据、测试计数（128→153）、workflow 激活状态全部对齐真实；账本/激活 gate 文档同步。P0-1/2/3 在 exact head 复跑 153 tests / 151 pass / 2 skip / 0 fail 成立。
- **P1 分支基线对齐**：`agent/execution-run-p1`（已含 P1-1/2/3 + Family Space grounding）并入 P0 收口（workflow 激活、electron 修复、账本），merge 冲突仅 ZCODE 账本，手动消解后 P1 分支测试仍全绿（169/163/0/6）。
- **真实压测全链验证**：重新 clone 真实 `YuemingHub/Family-Space` production `3aec7ea`；`FAMILY SPACE GROUNDING RESULT: PASS`（16/16）与 `FAMILY SPACE FIX REGRESSION RESULT: PASS`（9/9）均成立；`SCRATCH MUTATION RESULT: PASS`（P1-1/2/3 真实 Harness smoke）。

### 验证证据
- FTS 全量 169 pass / 0 fail / 6 skip（P1 分支合并 P0 收口后）。
- `SCRATCH MUTATION RESULT: PASS`、`FAMILY SPACE GROUNDING RESULT: PASS`、`FAMILY SPACE FIX REGRESSION RESULT: PASS`。
- PR #22 四个 workflow 对 exact head 全绿（`ci` / `aaop-setup-smoke` / `harness-acp-smoke` / `desktop-windows-package-smoke`）。

### 遇到的问题与弯路
- **弯路**：electron-builder 在真实 Windows runner 首次失败，最初误以为是 workflow 权限或打包配置问题，实际根因是 electron 43 版本移除了 npm postinstall，CI 干净环境无二进制。经本地 `install.js` 复现确认后修复。
- **弯路**：合并 P0 收口到 P1 分支时 ZCODE 账本两侧都改了 P0-4 状态，产生内容冲突；以「保留两侧真实事实」原则手工消解。

### 好经验
- 权限是**动态**的：历史记录「缺 workflow scope」不构成当前事实，每次以真实 push/CI 结果为准。
- repository-owned 脚本是 workflow 的薄 runner 的正确形态：CI 发现的环境差异（electron 二进制缺失）修在 ps1，而不是给 workflow 加第二个实现。
- 真实项目压测在凭据缺失时仍可闭环「grounding + 修复规格 + 回归断言」，把唯一 human blocker（provider 凭据）暴露到最小。

### 下一轮入口
- **唯一剩余 human blocker**：真实 provider 凭据 `DEEPSEEK_API_KEY`。凭据就绪后：`intake → authorize(CURRENT_STATE.md) → execute(真实 Harness 真实 Agent) → git delta → smoke-family-space-fix.mjs 回归断言 → aaop-family.cjs setup/ready → Evidence → outcome`。
- **owner 动作**：review/merge PR #22（四个 P0 gate 全闭合，Draft 保持待审）；此后 P1 分支（`agent/execution-run-p1`，已含 P1-1/2/3 与完整 P0 基线）可进入 review。
