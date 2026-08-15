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
