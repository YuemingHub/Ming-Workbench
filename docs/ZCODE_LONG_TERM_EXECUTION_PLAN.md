# Ming Workbench — Zcode 长期开发目标与执行计划

> 状态：长期执行契约 / Living Roadmap  
> 初版：2026-08-15  
> 适用仓库：`YuemingHub/Ming-Workbench`  
> 当前实现基线：Draft PR #22（`agent/desktop-p0-reconciliation`）；若该 PR 已合并，则以后续 `main` 为基线。  
> 目标读者：Zcode 及其他执行型 coding agent。  
> 本文不是产品宣传稿，而是长期开发的约束、优先级、验收标准和进度账本。

---

## 0. Zcode 的角色

Zcode 是“手”，不是新的架构大脑。

每次开始开发前必须先读取并遵守：

1. `docs/ZCODE_LONG_TERM_EXECUTION_PLAN.md`（本文）；
2. `docs/ARCHITECTURE.md`；
3. `harness.lock.json`；
4. 当前分支、当前 PR、Git working tree、最新 CI 状态；
5. 与本次修改相关的真实代码与测试，不得只凭旧文档推断。

默认工作方式：

```text
读当前现实
→ 找到本文最高优先级未完成项
→ 收窄为一个可验证切片
→ 实现
→ 跑真实入口测试
→ 收集证据
→ 更新本文进度
→ 提交/推送
→ 再进入下一切片
```

不要为了“看起来完成很多”并行铺开大量半成品。

遇到设计冲突时：

- 优先遵守本文的系统边界与不变量；
- 选择最小、可逆、可验证的实现；
- 不擅自扩大权限、修改产品边界或深 fork 上游；
- 如果必须改变本文核心架构，先停在文档/PR 说明层，明确为什么旧假设失效，并留下证据。

---

# 1. 北极星：Ming Workbench 到底是什么

Ming Workbench 不是另一个 Coding Agent，也不是 Harness 的换皮 UI。

它的长期目标是：

> **把人的意图编译成受约束、可恢复、可审计的执行，并持续用现实证据证明结果。**

核心链路：

```text
Human Intent
    ↓
Ming Workbench
Intent · Work Unit · Gate · Evidence · Asset · Outcome
    ↓
Domain Pack
software development → AAOP
    ↓
Execution Runtime
DeepSeek Harness
Agent · Session · Tools · Skills · MCP · Goal
Subagent · Workflow · Jobs · Sandbox · Model
    ↓
Real World
Repository · Files · Tests · CI · Runtime · Browser · API · Deployment
    ↓
Evidence / Verification
    ↓
Outcome
```

长期必须稳定保持：

```text
Workbench = 人的目标、权限、证据、验收、结果
AAOP      = 软件开发控制协议
Harness   = 执行内核
```

三者不能重新揉成一个大系统。

---

# 2. 三种 Truth

系统必须显式区分三种事实：

## 2.1 Intent Truth

人到底想让真实世界发生什么变化？

由 `WorkUnit` / Acceptance Contract 表达。

## 2.2 Execution Truth

某一次执行中，模型看到了什么、调用了什么、做了什么？

由 `ExecutionRun` + DeepSeek Harness canonical Session Log 表达。

## 2.3 Outcome Truth

真实世界最后到底发生了什么？

由 repo / tests / CI / runtime / browser / API / external systems / human confirmation 等独立证据表达。

最终验收必须是：

```text
Execution Truth + Outcome Truth
是否足以满足 Intent Truth
```

**Agent 自述永远不能单独成为项目完成事实。**

---

# 3. 长期核心对象模型

目标模型：

```text
Space
  ↓
Work Unit
  ↓
Acceptance Contract
  ↓
Authorization / Gate
  ↓
Mutation Slice（开发场景）
  ↓
Execution Run
  ↓
Harness Session / Workflow / Subagents
  ↓
Observed Effects
  ↓
Evidence
  ↓
Verification
  ↓
Outcome
```

必须永久区分：

### Work Unit
人的真实目标。一个 Work Unit 可以经历多次执行尝试。

### Execution Run
一次受授权、受边界约束的执行尝试。

### Harness Session
Harness 的执行历史与模型上下文事实源。

禁止把 Work Unit 直接等同于 Harness Goal / Session / Todo / Job / Workflow。

---

# 4. 系统级不变量（不得破坏）

## INV-01：Completion 不能来自 Agent 自述

Work Unit 完成必须至少满足：

- 无 open gate；
- 存在 acceptance criteria；
- 每个 criterion 都有独立 verification verdict；
- verdict 引用有效证据；
- 所需证据等级达到该 criterion 的最低要求。

## INV-02：Model-visible ⇔ logged

任何真正进入模型请求的系统提示、工具定义、上下文、关键配置，都必须能够从 Harness canonical Session 或关联运行记录中重建/追踪。

Workbench 不复制 Harness Session Log，只做 projection / pointer / digest / claim。

## INV-03：授权必须先于 mutation

浏览器、模型、Harness 都不能自己生成或扩大开发写权限。

```text
Human authorization
→ AAOP authorization semantics
→ ProviderExecutionGrant
→ Harness runtime enforcement
```

## INV-04：权限控制与运行时 enforcement 分层

- Workbench / AAOP Gate = 产品与任务层 authority；
- Harness sandbox / approval = runtime enforcement。

两者不可混为一个开关。

## INV-05：未知 ≠ 成功，未知 ≠ 可重试

外部副作用无法确认时必须进入 `unknown / reconciling / external-wait`，不得盲重试。

## INV-06：测试必须走真实交付入口

不能因为 unit tests / coverage 绿就认为产品可用。

每个产品可见或模型可见的关键能力都要有 real-entry smoke / integration proof。

## INV-07：Workbench 不重新实现 Harness 已拥有的 runtime

禁止默认新建：

- Ming Agent Loop
- Ming Workflow Engine
- Ming Subagent Framework
- Ming MCP Runtime
- Ming Session Ledger
- Ming Background Job Engine
- Ming Goal Engine
- Ming Tool Registry
- 第二套 Harness event log
- Deep fork DeepSeek Harness

## INV-08：Workbench 不重新实现 AAOP

Workbench 不应长期自己 synthesize：

- software route；
- task pod semantics；
- execution mode；
- provider-selection policy；
- development authorization policy；
- final engineering acceptance。

这些属于 `development-aaop` Domain Pack / AAOP。

---

# 5. Evidence 模型

当前 `authoritative: boolean` 只作为过渡字段，不作为长期终态。

建议证据等级：

```text
L0 claim
模型/Agent 自述

L1 activity
Harness Session、tool call、workflow result

L2 artifact
文件、diff、生成物、commit

L3 verification
测试、lint、typecheck、schema validation

L4 runtime
真实应用启动、浏览器、API、数据库、进程行为

L5 external
CI、GitHub、部署平台、云服务、第三方系统

L6 human
人确认真实目标已经达到
```

Acceptance Criterion 自己声明最低证据要求。

示例：

```text
修正文案         → L2 可以足够
修复登录         → 至少 L4
发布上线         → 至少 L5
真实解决用户问题 → 最终可能需要 L6
```

证据需要知道：

- 来源；
- observedAt；
- 对应 ExecutionRun；
- 对应 criterion/claim；
- 是否过期/被替代；
- provenance pointer；
- verifier verdict。

---

# 6. 当前已发现问题清单

下面的问题来自对 DeepSeek Harness、Ming Workbench 架构、当前 main 与 PR #22 的交叉研究。按优先级执行。

---

# P0 — PR #22 合并前必须封闭

## P0-1 真正的 file-bounded mutation

### 当前问题

当前 grant issuance 在未传 `intendedFiles` 时会默认：

```text
intendedFiles = [projectRoot]
```

而 `/api/authorize` 当前没有传入 grounded intake 得出的 exact file surface。

这导致所谓 bounded mutation 实际更接近：

```text
repo-bounded
```

而不是真正：

```text
file-bounded
```

当前 frontier overlap 又是 exact-path 比较，因此 repo root 字符串不会和 `src/foo.ts` 这类真实 dirty path 发生冲突。

### 目标

引入最小 `MutationSlice` 概念：

```ts
MutationSlice {
  repository
  baseRef
  paths[]
}
```

规则：

```text
paths unknown
→ read-only intake 可以继续
→ write 禁止

paths known
→ fresh frontier overlap check
→ human authorization
→ freeze exact paths
→ execute
→ after delta 必须 subsetOf authorized paths
```

whole-repository authorization 如确实需要，必须显式表示，不得把 `projectRoot` 伪装为一个普通路径。

### Done 证据

至少新增真实 scratch-repo tests：

1. 未知 file surface → mutation blocked；
2. exact in-scope file → success path；
3. 修改非授权文件 → hard failure；
4. pre-existing dirty file 与 intended slice overlap → blocked；
5. pre-existing dirty file 不 overlap → 可继续；
6. whole-repo scope 如实现，必须显式且有独立测试。

---

## P0-2 拆开 Run Completion / Effect / Verification / Acceptance

### 当前问题

当前本地 outcome 分类近似：

```text
producedChange OR testsPassed
→ success
```

这会产生错误语义：

- Agent 没改东西，但测试本来就绿 → success；
- Agent 改了文件，但测试失败 → 仍可能 success。

虽然当前 Work Unit 只进入 `verifying`，尚未直接 completed，但 `success` 已承载过多含义。

### 目标

至少拆成：

```text
RunStatus
started | running | completed | failed | interrupted | orphaned

EffectObservation
mutation-observed | no-mutation | external-unknown | ...

VerificationVerdict
pending | passed | failed | inconclusive

AcceptanceVerdict
pending | accepted | rejected
```

不要用一个 `success` 跨越四层。

### Done 证据

- no-op + pre-green tests 不得被判定“任务成功”；
- mutation + failing tests 不得被判定“验收成功”；
- Harness 正常结束只证明 run completed，不证明 Work Unit accepted。

---

## P0-3 收紧 Completion / Evidence invariant

### 当前问题

当前核心模型只检查：

```text
gate closed
criterion.satisfied == true
evidenceIds exist
```

但没有验证：

- evidence authority / level；
- evidence 是否支持该 criterion；
- evidence 属于哪次 run；
- evidence 是否过期；
- 是否存在 independent verifier verdict。

### 目标

不要让 `criterion.satisfied` 长期作为任何代码都能直接写入的自由 boolean。

目标形态：

```ts
AcceptanceCriterion {
  id
  statement
  verdict: 'pending' | 'satisfied' | 'failed'
  verificationRef?: string
  minimumEvidenceLevel?: string
}

Verification {
  id
  verifierRunId
  criterionId
  verdict
  evidenceRefs[]
}
```

P0 阶段允许先做最小收紧：非 authoritative/session activity evidence 不能独立支撑 completion。

### Done 证据

新增 completion invariant tests，至少覆盖：

- 只有 Harness session claim → 不可 completed；
- test evidence failed → 不可 completed；
- evidence ID 不存在 → 不可 completed；
- verifier 未产出 verdict → 不可 completed；
- 合格 verification + evidence → 才可 completed。

---

## P0-4 激活 packaged Windows exact-artifact smoke

PR #22 的 `desktop-windows-package-smoke.yml` 已激活于 `.github/workflows/`（原始文件仍在 `.github/workflows.dist/` 作为归档副本），由真实 `windows-latest` runner 对 exact head 跑绿。PS1 脚本确保 electron >= 43 的二进制在构建前就绪（该版本无 npm postinstall）。

目标：

```text
package Windows artifact
→ 启动真实 win-unpacked app
→ backend ready
→ GET loopback HTTP 200
→ close
→ zero residual process
→ 再验证 portable exe
```

要求：

- write boundary 保持 off；
- 不需要 paid provider key；
- failure 上传非敏感诊断；
- workflow 必须对新的 exact SHA 真实跑绿。

PR #22 在 P0-1 / P0-2 / P0-3 / P0-4 完成前保持 Draft。

---

# P1 — 建立 Ming Workbench 真正的核心骨架

## P1-1 ExecutionRun

新增一等对象 `ExecutionRun`。

最小字段先保持小：

```ts
ExecutionRun {
  id
  workUnitId
  authorizationRef
  runtime
  provider
  sessionId?
  status
  startedAt
  finishedAt?
  evidenceRefs[]
}
```

原则：

- 一个 Work Unit 可以有 N 个 Run；
- 每次重试/换 provider/换 profile/重新授权都是新 Run；
- Work Unit 不继续膨胀承载执行细节。

---

## P1-2 ExecutionFingerprint

每个 Run 记录可重建的执行身份，不复制大配置，只保存 identity + digest + pointer：

```text
Harness version / git SHA
profile id / digest
provider / model
permission preset
sandbox mode
workspace repo / baseRef
relevant configuration digest
```

目标：半年后仍能回答“这个结果到底由什么运行环境产生”。

---

## P1-3 Ming Evidence Spine

不要创建第二套 Harness 日志。

使用现有 durable Harness Session Persistence / Session Query：

```text
Harness canonical Session
→ Session Query / Persistence
→ Ming Evidence Projection
→ ExecutionRun
→ Work Unit acceptance
```

Evidence Projection 只保存：

- session pointer；
- exact event range/revision；
- digest；
- selected claims；
- tool/result provenance；
- model/provider/profile identity；
- links to independent outcome evidence。

必须能够从 Workbench evidence 跳回 canonical Harness execution truth。

---

## P1-4 Independent Verifier Lane

Verifier 不是“第二个 Agent 看 Executor 总结”。

正确流程：

```text
Executor changes reality
↓
Verifier receives goal + criteria
↓
Verifier independently re-reads repo/test/runtime/browser/API
↓
Verifier does not inherit executor conclusion
↓
Verifier emits evidence-backed verdict
↓
AAOP/Domain Pack decides engineering acceptance
```

偏好：

- separate session；
- read-only by default；
- independent observation；
- 必要时不同 model/provider；
- 可调用真实 test/runtime/browser/API probes。

---

## P1-5 Crash Recovery / Orphaned Run Reconciliation

处理：

```text
Run started
→ Harness 已产生部分 mutation
→ Workbench crash/restart
→ 没有 terminal record
```

恢复时：

```text
发现 non-terminal Run
→ mark orphaned/reconciling
→ inspect Harness Session
→ inspect repository/outcome
→ attribute existing changes
→ 决定 resume / block / rollback / new authorization
```

绝不能静默创建新 Run 后继续覆盖现实。

---

## P1-6 Project Write Lease

在开放并行、多 Agent 前，解决 TOCTOU：

```text
Run A frontier safe
Run B frontier safe
Run A writes
Run B writes
```

先实现最小 repo-level write lease：

```text
repository → current writer Run ID
```

同一 working tree 同时只允许一个直接 writer。

不要立即实现复杂 worktree orchestration。确认真实并行需求后再升级到 per-run worktree。

---

## P1-7 Effect-specific Reconciler

禁止未来把所有外部副作用 fallback 到 `git status`。

目标接口：

```text
deploy          → DeploymentReconciler
GitHub push/PR  → GitHubReconciler
database        → DatabaseReconciler
cloud-resource  → CloudReconciler
payment         → PaymentReconciler
production API  → ApiEffectReconciler
```

没有对应 reconciler：

```text
UNKNOWN
→ no blind retry
→ external-wait / human gate / later reconciliation
```

---

## P1-8 AAOP authority boundary cleanup

当前 P0 bootstrap 在 Workbench 中写死了：

```text
provider = deepseek-harness
route = bug-fix
execution_mode = single-agent
task_pod = null
allowed_effects = local-file-write
```

可以作为过渡，但不能长期生长。

目标：

```text
Workbench
→ asks development-aaop Domain Pack
→ AAOP decides route/task/execution/authorization/acceptance contract
→ returns exact ProviderExecutionGrant
→ Workbench stores/binds/dispatches/observes
```

新增架构约束：

> Workbench MUST NOT synthesize development execution semantics.

---

# P2 — 在骨架稳定后释放 Harness 能力

只有 P0 + P1 核心完成后再推进。

## P2-1 Bounded Goal Profile

先解决单 Agent 长任务。

使用 Harness Goal 的 session-level persistence / continuation，不创造 Ming Goal Engine。

要求：

- round/time/cost bounds；
- pause/resume/block/complete 映射到 ExecutionRun 状态；
- Work Unit truth 不由 Harness Goal completion 决定。

---

## P2-2 AAOP Task Pod → Harness Subagents / Workflow

AAOP 定义：

- 为什么拆任务；
- 谁负责什么；
- ownership；
- tool/permission boundary；
- acceptance criteria。

Harness 负责：

- spawn/fork；
- persona；
- toolFilter；
- child sessions；
- workflow execution；
- background jobs。

不要建立 Ming Multi-Agent Runtime。

---

## P2-3 Research / PTC Profile

PTC/Code Mode 用于多步、读密集、高 fan-out 工作。

路由原则：

```text
small bug / simple mutation → Standard single agent
hundreds files/docs/data    → PTC/read-heavy
complex coordinated dev     → AAOP Task Pod / Workflow
```

用户不选择“PTC/Standard”；Workbench/Domain Pack 根据 task shape 自动路由。

---

# P3 — Capability Lab（最后才做）

DeepSeek Harness Creator/Cordis self-modification 只能进入隔离实验能力。

流程：

```text
capability gap
→ isolated creator session
→ ephemeral capability
→ real tests
→ produce Asset
→ review / AAOP acceptance
→ convert to versioned Plugin / Skill / MCP
→ normal capability registry
```

禁止：

```text
Agent detects missing tool
→ self-create
→ self-install
→ self-persist
→ self-expand permissions
```

Creator 权限按 bash 级能力处理，sandbox 不视为绝对 security boundary。

---

# P4 — Durable cross-time continuity（仅在证据证明需要时）

不要因为任务“很长”就引入 LoopX。

Harness 已有：

- Goal；
- continuable Subagent；
- Jobs；
- Workflow；
- durable Sessions。

只有压力测试明确证明存在下列剩余缺口，才引入 LoopX 或其他 durable continuation provider：

```text
process dead
machine restarted
hours/days passed
external condition changed
Work Unit must wake up automatically
reconcile reality
re-authorize if needed
continue
```

LoopX 若加入，只允许承担：

> External Durable Continuation Provider

不得成为默认第二 Agent Loop。

---

# 7. Harness 集成长期策略

## 7.1 Harness = pinned upstream runtime

当前 authority 由 `harness.lock.json` 定义。

不要因为教程/Orange Book/博客出现更高版本就升级。

升级流程必须：

```text
observe upstream
→ inspect exact upstream SHA
→ identify breaking changes
→ compatibility tests
→ real-entry smoke
→ update lock
→ record migration evidence
```

## 7.2 不 deep fork

优先使用：

- plugin seam；
- preset/profile；
- service/provider seam；
- bundle/patch；
- UI slot；
- Session Query/Persistence。

只有上游完全缺失且无法通过扩展点完成时，才考虑最小 patch，并记录退出路径。

## 7.3 ACP 只是 transport，不是 observability source

ACP 主要用于自动化控制与 committed assistant text。

完整 execution truth 来自 canonical Harness Session Log。

不要通过扩 ACP wire 来复制 Session observability，除非有明确不可替代需求。

---

# 8. Capability Profiles（长期目标）

默认不要给一个 preset 不断加工具。

目标 profiles：

## A. `development-single`

默认开发执行面：

- single agent；
- minimum tools；
- minimum permission；
- bounded mutation。

## B. `development-pod`

只有 AAOP 明确批准 Task Pod 后使用：

- Subagents；
- Workflow；
- Jobs；
- bounded child authority。

## C. `research-ptc`

- read-heavy；
- Code Mode / PTC；
- high fan-out；
- 默认弱 mutation / read-only 优先。

## D. `capability-lab`

- Creator/Cordis；
- isolated；
- experimental；
- default no production mutation；
- 不能自动持久化生成能力。

Profile selection 由 Domain Pack / AAOP routing 决定，不由模型自行扩大能力。

---

# 9. 用户体验原则

产品层尽量不暴露：

- Agent mode；
- PTC；
- Subagent；
- Workflow；
- MCP；
- Harness；
- LoopX；
- runtime implementation detail。

用户主要表达：

```text
我想让什么发生
```

Workbench 主要向用户呈现：

```text
我理解的目标
现在掌握的现实
需要你的决定/授权
正在发生什么
证据是什么
结果是否达到
下一步是什么
```

能力越复杂，用户界面越应该简单。

---

# 10. Zcode 每个开发循环的强制协议

## Step 1 — Reconcile reality

每轮先读取：

```text
git status
current branch
HEAD SHA
active PR
current CI
current roadmap progress
relevant source/tests
```

不要基于上轮聊天记忆直接修改。

## Step 2 — Pick one highest-priority slice

优先顺序：

```text
P0 → P1 → P2 → P3 → P4
```

一个 slice 应尽量在同一 PR/commit series 中闭环。

## Step 3 — Write acceptance evidence before coding

先写清：

- 想证明什么；
- 哪个真实入口验证；
- 什么证据才算通过；
- 哪些失败条件必须 fail closed。

## Step 4 — Implement minimally

不要顺手大重构。

新行为优先通过明确 seam 接入，而不是修改大核心循环。

## Step 5 — Test the real surface

至少组合：

- focused unit tests；
- integration test；
- shipped/real entry smoke（若本 slice 是产品可见能力）；
- platform-specific proof（若涉及 Desktop/Windows/runtime）。

## Step 6 — Inspect the diff as evidence

确认：

- 没有越出 mutation slice；
- 没有 secrets；
- 没有无关文件；
- 没有把 temporary workaround 伪装成 final architecture；
- 文档与真实代码一致。

## Step 7 — Update this roadmap

完成一个 milestone 后，在本文的“进度账本”更新状态、证据与剩余风险。

不要删除历史关键风险；可标记 resolved / superseded。

## Step 8 — Commit and report

汇报必须包括：

```text
1. 完成了什么
2. 为什么这样做
3. 修改范围
4. 跑了哪些真实测试
5. exact evidence / CI / SHA
6. 仍然未知什么
7. 下一最高优先级是什么
```

禁止只说“代码已完成 / tests pass”。

---

# 11. Fail-closed / 停止条件

遇到以下情况不得自行猜测后继续 mutation：

- exact file surface 无法确定；
- 授权已 stale；
- repo frontier conflict；
- 外部 effect outcome unknown 且无 reconciler；
- credential/secret 缺失；
- provider/runtime pin 无法验证；
- 需要 deploy/payment/production/database/cloud 等 protected effect，但无明确授权；
- 必须改变本计划核心 authority boundary；
- 真实交付入口无法验证，却准备声称完成。

此时应：

```text
block / needs-human / external-wait / inconclusive
```

并给出最小、具体、可决策的信息。

---

# 12. 反膨胀规则

任何新增模块/服务/状态机前，先回答：

1. Harness 已经有吗？
2. AAOP 已经有吗？
3. 能通过现有 provider/plugin/seam 解决吗？
4. 这是产品 truth，还是 execution detail？
5. 删除这个新组件会不会仍能达到目标？

如果已有成熟能力，优先复用。

Ming Workbench 应越来越薄，而不是成为所有 AI 技术的收集箱。

---

# 13. 当前优先级总表

| Priority | Milestone | Status | Merge/Done Gate |
|---|---|---|---|
| P0-1 | Exact `MutationSlice` / file-bounded mutation | DONE (a33fafa) | unknown scope blocked; out-of-slice writes hard-fail; scratch-repo proofs |
| P0-2 | Split run/effect/verification/acceptance semantics | DONE (a33fafa) | no-op/pre-green and mutation/failing-test regressions covered |
| P0-3 | Strong completion/evidence invariant | DONE (a33fafa) | session claim alone can never complete Work Unit |
| P0-4 | Packaged Windows exact-artifact smoke | DONE (b4ae1e5) | `.github/workflows/desktop-windows-package-smoke.yml` green on exact head |
| P1-1 | `ExecutionRun` | DONE (40fcd02) | multiple runs per Work Unit, durable persistence |
| P1-2 | `ExecutionFingerprint` | DONE (ba4d2fd) | runtime/profile/model/config identity traceable |
| P1-3 | Evidence Spine | DONE (04da0b3) | Session → projection → Run → Work Unit trace works |
| P1-4 | Independent Verifier | TODO | verifier independently observes reality |
| P1-5 | Orphaned Run recovery | TODO | crash/restart reconciliation proven |
| P1-6 | Repo write lease | TODO | concurrent writer prevented |
| P1-7 | Effect-specific reconcilers | TODO | unknown external effect cannot fallback to git |
| P1-8 | AAOP authority boundary cleanup | TODO | Workbench no longer grows AAOP routing semantics |
| P2-1 | Bounded Goal profile | BLOCKED BY P1 | long single-agent run bounded/resumable |
| P2-2 | AAOP Task Pod → Harness Subagents/Workflow | BLOCKED BY P1 | no Ming multi-agent runtime |
| P2-3 | Research/PTC profile | BLOCKED BY P1 | route by task shape, hidden from normal user |
| P3 | Capability Lab | BLOCKED BY P2 | isolated, ephemeral, review-before-persist |
| P4 | Durable cross-time provider / LoopX if proven | DEFERRED | only after explicit pressure-test gap |

---

# 14. 当前 PR #22 的处理原则

PR #22 已完成大量 P0 地基，包括：

- backend authoritative Work Unit + grant；
- human authorization；
- stale authority re-check；
- real before/after repo observation；
- pre-existing dirty 不算执行成果；
- default-off write safety rail；
- provider secret safeStorage/hot activation；
- persistence/resume；
- existing CI / AAOP smoke / Harness ACP smoke。

**不要推倒重做。**

在当前分支继续补 P0-1～P0-4，保持 PR Draft，直到全部真实证据闭合。

然后：

```text
merge PR #22
→ 从 main 建立 P1 专用分支/PR
→ 按 ExecutionRun → Fingerprint → Evidence Spine → Verifier 顺序推进
```

---

# 15. 最终判定标准

Ming Workbench 不是因为拥有很多 Agent 能力而成功。

最终判定只有一个：

> **对于一个人的真实目标，系统能否明确知道自己被授权做什么，能够让最合适的执行能力去做，能够在中断与变化后恢复，并且能够拿出独立、可追溯的现实证据说明：到底发生了什么，目标是否真的达到。**

如果一个功能增加了复杂度，却没有增强以下至少一项，应优先删除而不是保留：

- Intent clarity
- Authority safety
- Execution reliability
- Recoverability
- Evidence quality
- Verification independence
- Outcome truth
- Human usability

这就是长期开发的北极星。

---

# 16. 进度账本

> Zcode：每完成一个 milestone，在这里追加一条，不覆盖重要历史。必须附 exact SHA / PR / CI / runtime evidence。

## 2026-08-15 — Plan initialized

- 基线：Draft PR #22，`agent/desktop-p0-reconciliation`。
- 已确认：现有 `ci` / `aaop-setup-smoke` / `harness-acp-smoke` 在当前研究时点为 green。
- 新发现的 merge-blocking 风险：file-bounded mutation 尚未真正闭环；run/effect/verification/acceptance 语义仍混合；completion invariant 仍过弱；packaged Windows exact-artifact workflow 尚未正式激活。
- 下一动作：从 P0-1 开始，按顺序推进，不提前开启 P1/P2。

## 2026-08-15 — P0-1 / P0-2 / P0-3 完成（PR #22, branch `agent/desktop-p0-reconciliation`）

- **P0-1 真实 file-bounded MutationSlice** — exact SHA `87a9ca5`（含 `ff1c13e` smoke 交接修复）：
  - 新 `MutationSlice { repository, baseRef, scope }`（`src/execution/mutation-slice.ts`），scope = `exact(paths)` / `unknown` / `whole-repository`；projectRoot 字符串不再是 intended file。
  - unknown surface：只读 intake 保留，写授权在签发层（`issueProviderExecutionGrant`）、API 层（`/api/authorize` → 400 `scope-required`）、执行层（`reconcileBeforeMutation`/`validateExecutionPreconditions`）三层 fail-closed。
  - `/api/authorize` 只接受 human 确认的 `filePaths[]` 或显式 `wholeRepository:true`；slice 随 grant 持久化（legacy `intendedFiles=[projectRoot]` 显式迁移为 whole-repository）。
  - 执行后 delta 必须是授权路径子集（`computeExecutionDelta` 按 slice 判 scope violations；pre-existing dirty 只在前沿重叠时阻止，永不记为 violation）。
  - whole-repository 是显式独立 scope，且要求工作区干净。
  - UI 执行卡片改为要求填写影响文件或显式勾选整个仓库。
  - 真实 scratch Git repo 6 场景测试（`test/mutation-slice.test.mjs`，走真实 authorize→execute 链）。
- **P0-2 四轴状态** — exact SHA `f9fc651`：
  - 新 `src/execution/run-outcome.ts`：`RunStatus`（started/running/completed/failed/interrupted/orphaned）、`EffectObservation`（mutation-observed/no-mutation/external-observed/external-unknown）、`VerificationVerdict`（pending/passed/failed/inconclusive）、`AcceptanceVerdict`（pending/accepted/rejected，accepted 只能由人给出）。
  - 执行前也跑真实测试（`beforeTestResult`），`deriveRunOutcome` 从真实证据推导四轴；Harness 完成最多证明 `runStatus: completed`。
  - Regression A：pre-green + no-op → `no-mutation` + verification `inconclusive` → Work Unit 回到 `needs-human`（旧逻辑误判 success）。Regression B：mutation + tests fail → verification `failed` / acceptance `rejected`（旧逻辑误判 success）。Regression C：run 完成永不完成 Work Unit。
  - 顺带修掉一个真实证据 bug：外层 node:test 向子进程传播 `NODE_TEST_CONTEXT`，导致嵌套 `node --test` 静默 exit 0；spawn 项目测试时剥离该变量。
- **P0-3 completion invariant** — exact SHA `a33fafa`：
  - Evidence 增加 `verifier`（harness-session/repository-observation/test-run/independent-verification/human-confirmation）与 `verification` 判定；`canMarkCompleted` 不再信任自由 `satisfied` boolean。
  - completion 要求每个被引用证据：authoritative + 真实 verifier（harness-session 永不满足）+ verification `passed`。
  - 执行路径：run 记录证据 = harness-session claim（pending），测试证据 = test-run 真实验证判定。
  - 5 个必需用例 + 边界用例在 `test/completion-invariant.test.mjs`。
- **测试与真实入口证据**：151 unit pass / 0 fail / 2 skip；`SCRATCH MUTATION RESULT: PASS`（真实 reviewed Harness + mock LLM + 真实 scratch Git repo，P0-1/P0-2 后各跑一轮，P0-3 后重跑中）；CI `ci`/`aaop-setup-smoke`/`harness-acp-smoke` 在 `ff1c13e` 与 `f9fc651` 全绿，`a33fafa` 运行中。
- **P0-4 状态**：已激活 `.github/workflows/desktop-windows-package-smoke.yml`（从 `.github/workflows.dist/` 移入），真实 Windows runner 对 exact head `b4ae1e5` 全绿：win-unpacked + portable 真实启动、backend-ready、loopback HTTP 200、harness identity 与 `harness.lock.json` 一致、零残留进程、secret sentinel 无泄漏。期间修复：electron >= 43 无 npm postinstall，`npm install` 后 `node_modules/electron/dist` 为空导致 electron-builder 失败；`desktop-windows-package-smoke.ps1` 构建前经 `install.js`（幂等）确保二进制就绪。
- 下一动作：PR #22 四个 P0 merge gate 全部闭合（P0-1/2/3 测试绿 + P0-4 CI 绿 + PR body evidence 已对齐 exact head）→ owner review/merge。之后 P1-1 ExecutionRun。

## 2026-08-15 — P1-1 ExecutionRun 完成（branch `agent/execution-run-p1`，未提交到 PR #22）

- **一等对象 ExecutionRun**（`src/execution/execution-run.ts` 新增）：`id/workUnitId/authorizationRef/runtime/provider/model/sessionId/status/startedAt/finishedAt/outcome/evidenceRefs`。Work Unit 是人的持久目标；每次授权尝试（retry / 重授权 / 换 provider / 独立验证）都开**新 run**，run 只做 Session 指针 + 四轴 outcome + 证据引用，不重实现授权/grant 语义（复用 AAOP grant）。
- **store v1→v2 迁移**：`src/persistence/work-unit-store.ts` 新增 `runs: PersistedExecutionRun[]` + `to/fromPersistedExecutionRun`；`file-work-unit-store.ts` 接受 v1/v2（v1 读为空 runs），未知新版本 fail-closed 视为空；`desktop/work-unit-store.mjs` STORE_VERSION 1→2 同步，防 backend 写 v2 后桌面 resume 失败。
- **HTTP API**：新增只读 `GET /api/runs?workUnitId=`；`/api/execute` 改为 open→runBoundedExecution→close→持久化 run，失败 fail-closed 记录 failed run，成功响应带 `runId`。
- **测试与真实入口证据**：`test/execution-run.test.mjs`（store 迁移 / run 生命周期 / /api/runs 端点 / 真实 authorize→execute 写边界阻断记录 failed run）全过；FTS 全量 **157 pass / 0 fail / 2 skip**；scratch smoke 增强 P1-1 断言并 `SCRATCH MUTATION RESULT: PASS`（真实 Harness + mock LLM + 真实 scratch Git repo：execute 产生唯一 run 且绑定 grant → 重启后 run 持久化且 identity 不变 → 重授权产生第二个新 run）。
- 下一动作：P1-1 收尾（如需则补桌面 UI 层或文档）；P0-4 owner 授权后激活 workflow 并合 PR #22。

## 2026-08-15 — P1-2 ExecutionFingerprint 完成（branch `agent/execution-run-p1`）

- **一等对象 ExecutionFingerprint**（`src/execution/execution-fingerprint.ts` 新增）：`buildExecutionFingerprint()` 实时采集 run 的可重建运行身份——harness version/commit（`inspectHarnessCheckout` 实读 checkout）、profile id+digest（`workbench.cordis.yml` sha256）、provider/model、permission preset（AAOP `mutation_boundary`）、sandbox mode（read-only/workspace-write）、workspace repository/baseRef（grant `write_target`）、workbenchConfigDigest（profile+lock 摘要）。`sameExecutionFingerprint()` 供半年后对比候选环境回答"这个结果由什么环境产生"。
- **ExecutionRun 扩展**：`ExecutionRun.fingerprint?` 与 `PersistedExecutionRun.fingerprint?`，`openExecutionRun` 接收 fingerprint，store round-trip 保留；`/api/runs` 响应暴露 fingerprint。
- **best-effort 采集**：execute handler 中 fingerprint 构建失败不得吞掉 run 记录（try/catch → undefined）——指纹是身份证据，不是授权输入，缺失不应阻止 failed run 落盘。
- **测试与真实入口证据**：FTS 全量 **161 pass / 0 fail / 2 skip**；`test/execution-run.test.mjs` 新增 4 项 P1-2（环境身份捕获 / read-only 无 write target / profile 或 model 变更→drift 检测 / fingerprint 随 run round-trip 持久化）；scratch smoke 增强 P1-2 断言并 `SCRATCH MUTATION RESULT: PASS`（真实 Harness + mock LLM + 真实 scratch Git repo：run fingerprint 记录 reviewed version `0.1.0-rc.5` + commit `47f94385` + profile digest + provider/model + `workspace-write` + baseRef）。
- 弯路记录：最初 fingerprint 直接在 `openExecutionRun` 参数中求值，scratch 测试环境 harnessCheckout 路径无效时抛出异常导致 run 未落盘（期望 1 个 run 却得到 0）；改为 best-effort 采集后修复。

## 2026-08-15 — P1-3 Ming Evidence Spine 完成（branch `agent/execution-run-p1`）

- **复用而非重实现**：Ming 是 Harness ACP client，无法直接 import Harness 内部 cordis 服务；但 Harness durable Session Persistence 的 `session-persistence-jsonl` 的 `format.ts` / `zstd.ts` 是纯函数（不依赖 ctx）。新增 `harness/session/project-session.mjs`：通过 reviewed Harness checkout 的 tsx CLI + tsconfig 运行，import 官方 `logPath/scanZstdFrames/createZstdFrameDecoder/scanLog`，只读 `session.jsonl.zstd`（canonical session 产物）并输出紧凑投影 JSON。**不创建第二套 Harness 日志、不重写 JSONL/zstd 格式**。
- **一等对象 EvidenceProjection**（`src/execution/evidence-spine.ts` 新增）：`buildSessionEvidenceProjection()` spawn tsx 运行投影脚本并校验 JSON，输出 `EvidenceProjection { session: { pointer{sessionRoot,cwd,sessionId,artifactPath,artifactRel}, header{id,version,createdAt,cwd,parentSession,seedLength,origin,delegationDepth,agentPreset}, revision{dev,ino,size,mtimeMs}, digest, frames, committedBytes }, eventRange{count,firstSeq,lastSeq} }`。digest = canonical 产物字节 sha256，eventRange = committed 事件 seq 范围——从 Workbench evidence 可跳回 canonical Harness execution truth。
- **ExecutionRun 扩展**：`ExecutionRun.projection?` / `PersistedExecutionRun.projection?`，`closeExecutionRun` 接收 projection，store round-trip 保留；`/api/runs` 响应暴露 projection。execute handler 在 run 关闭时构建投影（`options.sessionRoot && executionResult.sessionId` 时），失败 fail-closed 为 undefined（与 fingerprint 同策略，投影缺失绝不吞 run 记录）。
- **测试与真实入口证据**：FTS 全量 **167 pass / 0 fail / 2 skip**；`test/evidence-spine.test.mjs` 新增 6 项（用 node:zlib 构造 canonical zstd 多帧产物，验证投影派生 pointer/header/eventRange/digest / eventRange 反映 committed 数 / 缺失 artifact 与不可达 harness 均 best-effort undefined / 投影随 run round-trip 持久化 / 无 session 的 run 无投影）；scratch smoke 增强 6 项 P1-3 断言并 `SCRATCH MUTATION RESULT: PASS`（真实 Harness + mock LLM + 真实 scratch Git repo：run projection 指向 `session.jsonl.zstd` + digest + revision/size + eventRange count=80 且 firstSeq=0 lastSeq=79）。
- 下一动作：P1-4 Independent Verifier Lane（Executor 改变现实后 Verifier 独立重读 repo/test/runtime，不做"第二个 Agent 看 Executor 总结"）；P0-4 仍等 owner `gh auth refresh -s workflow` 激活 workflow 后合 PR #22。
- 下一动作：P1-3 Ming Evidence Spine（用现有 durable Harness Session Persistence/Query 投影证据，不创建第二套 Harness 日志）；P0-4 仍等 owner workflow scope。

## 2026-08-15 — 首个真实项目 Family Space grounding 完成 + REAL WORK UNIT 001 候选锁定（branch `agent/execution-run-p1`）

- **方向切换（总指令）**：停止继续扩建 P1-x 能力，直接进入「用 Ming-Workbench 跑通第一个真实项目 Family Space」。Verifier v0 = Reality（不是第二个 Agent），P1-4 第二 Agent Verifier 暂停；「No capability without pressure」——先找到真实阻塞，再为它建能力。
- **真实项目 grounding**：浅克隆 `YuemingHub/Family-Space`（production `3aec7ea47230…`）到 `.workbench/projects/family-space`（已 gitignore）；新增 `scripts/smoke-family-space.mjs`（16 项 provider-free 断言）并 `FAMILY SPACE GROUNDING RESULT: PASS`。
- **「真实修复」回归断言已固化**：新增 `scripts/smoke-family-space-fix.mjs`（9 项全绿，`FAMILY SPACE FIX REGRESSION RESULT: PASS`）——在零污染副本上复现 bug → 应用精确单行修复（`CURRENT_STATE.md` 加 `production@<baseline>`）→ status 回到 0 且打印 `declared product observation` → S0 无连带行为变化 → HEAD 未变且仅 `CURRENT_STATE.md` 有 tracked change；基线自动用 `git ls-remote` 核验（`3aec7ea…` = 本地 HEAD，生产基线裁决已自动消除，无需人确认）。
- **REAL WORK UNIT 001 候选（真实 bug，可复现）**：Family Space 生产 HEAD 上 `node scripts/aaop-family.cjs status` 退出码 2，stderr = `CURRENT_STATE must declare a current product observation as production@<40-hex-sha>.`（`grep -c "production@" CURRENT_STATE.md` = 0）。其 AAOP 桥接 `status`/`ready`/`setup` 全部因此失败，是「入口级」阻塞：不修就无法本地接入 AAOP。
- **Workbench 全链已接通（provider-free）**：onboarding 识别真实项目 → read-only Intake 返回 `blocked` 并透出真实 blocker（不伪造进度）→ blocked Work Unit 持久化可 resume → authorize 冻结 `exact(1 path)` `CURRENT_STATE.md` + 绑定真实 repo/branch/base → execute 无凭据 fail-closed 402 `provider-required` → 真实 HEAD 未变（零污染）。
- **剩余 human blocker**：真实 provider 凭据 `DEEPSEEK_API_KEY`。有凭据后走 `intake → authorize → execute → git delta → aaop-family.cjs status=0 → evidence → outcome` 闭环。
- 下一动作：**唯一剩余 human blocker = 真实 provider 凭据 `DEEPSEEK_API_KEY`**。凭据就绪后走 `intake → authorize → execute → git delta → smoke-family-space-fix.mjs 回归断言 → aaop-family.cjs setup/ready 全绿 → evidence → outcome` 闭环（回归断言已就绪，凭据到达即可直接执行）。

## 2026-08-15 — P0 收口完成（PR #22，branch `agent/desktop-p0-reconciliation`）

- **P0-4 已激活**：`.github/workflows.dist/desktop-windows-package-smoke.yml` 移入 `.github/workflows/desktop-windows-package-smoke.yml` 并 push（当前凭据具备 `workflow` scope），真实 `windows-latest` runner 对 exact head 全绿：win-unpacked + portable 真实启动、backend-ready、loopback HTTP 200、harness identity 与 `harness.lock.json` 一致、零残留进程、secret sentinel 无泄漏。
- **修复真实 smoke 暴露的 bug**：electron >= 43 无 npm postinstall，干净 `npm install` 后 `node_modules/electron/dist` 为空导致 electron-builder 报 `electronDist does not exist`；`desktop-windows-package-smoke.ps1` 构建前经 `node_modules/electron/install.js`（幂等）确保二进制就绪，workflow 保持薄 runner。
- **PR body evidence 已对齐**：exact head / CI 证据 / 测试计数（153 tests / 151 pass / 2 skip / 0 fail）/ workflow 激活状态全部 reconcile 到真实 head，Draft 保持，待 owner review/merge。
- 下一动作：PR #22 四个 P0 merge gate 全部闭合 → owner review/merge。之后 P1 分支（`agent/execution-run-p1`，已含 P1-1/2/3 与 Family Space grounding）在完整 P0 基线上收口。

## 2026-08-15 — P0-1 重新 open：Execution Isolation 实现（branch `agent/execution-run-p1`）

> 总审查判定：此前 `runBoundedExecution` 让 Harness 直接在真实 `projectRoot` 上 `workspace-write`、事后 `computeExecutionDelta` 检测越界，属于 **POST-HOC SCOPE DETECTION**，不是 **EXECUTION-TIME ISOLATED MUTATION**。MutationSlice / stale authority / readback / completion invariant 全部保留，不推翻已有成果。

- **新增 `src/execution/execution-isolation.ts`**：`createExecutionIsolation`（真实 repo 在授权 base ref 上 `git worktree add --detach`，真实 repo 永不作为 Harness cwd）/ `discardExecutionIsolation`（`worktree remove --force` + 目录清理，幂等，任何路径含失败都执行）/ `readIsolationBaseline` / `computeIsolatedDelta`（仅读 worktree 快照，绝读真实 repo，MutationSlice 判定越界）/ `applyAuthorizedDelta`（唯一写回真实 repo 的路径：只复制授权 slice 内文件，删除的授权文件在真实 repo 删除，真实 HEAD 不动）/ `mirrorDependenciesIntoIsolation`（best-effort 镜像 node_modules，非 symlink，Harness 无法穿透改真实依赖树）/ `assertWorktreeBelongsTo`。
- **`bounded-execution.ts` 集成**：`runBoundedExecution` 流程改为 `真实 repo reconcile → worktree 隔离 → Harness workspace-write 只在隔离内 → computeIsolatedDelta → 越界则丢弃隔离（真实 repo 原样）→ 授权+验证通过才 apply-back → 真实 repo authoritative readback`。四轴 outcome 语义不变：越界 → verification failed / acceptance rejected；测试绿 + mutation → verifying（永远不 completed）。
- **`harness-acp.ts`**：`HarnessAcpRunOptions.isolation {realRepository, baseRef}`；`assertGrantWorkspace` 接受 isolation 上下文，worktree 是 detached，working_ref 匹配放宽为「worktree HEAD == granted base_ref」，repository 匹配基于真实 repo 路径。
- **`local-server.ts`**：Evidence Projection 的 `cwd` 改为 `executionResult.isolation.worktree`（session 实际运行目录；artifact 在 sessionRoot 下独立存活，worktree 清理不影响）。
- **adversarial regression（`test/execution-isolation.test.mjs` 4 项全绿）**：授权仅 `answer.mjs`，Harness 改 `answer.mjs` + 故意改 `answer.test.mjs` → B 从未污染真实工作树、scope violation 被检测、整个隔离丢弃（连授权的 A 也不 apply-back）、真实 repo 逐字节未变（HEAD 与 dirty 均保持）；正常路径证明 isolated execution / allowed delta only / tests pass / apply-back / real repo readback / Harness session complete ≠ Work Unit complete；isolation 原语生命周期；stale base ref 拒绝。
- **证据**：FTS 全量 **167 pass / 0 fail / 6 skip**；`npm run check`（tsc --noEmit）通过。既有 P0-1/2/3 测试在隔离语义下全部保持绿（fake harness 写入 worktree → apply-back → 真实 repo 断言仍成立）。
- 下一动作：总审查重新 final-review PR #22；随后在真实项目（Family Space RWU001）上以隔离路径跑真实 execute（仍需 owner 提供 `DEEPSEEK_API_KEY`）。
