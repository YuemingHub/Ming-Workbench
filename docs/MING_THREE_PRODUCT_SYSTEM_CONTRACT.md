# Ming 三产品系统契约（Proposed）

> 日期：2026-08-27  
> 状态：Proposed / 未进入 `main` 权威  
> 目的：把 Family Space、归、Ming 的产品边界，以及 Ming Workbench / Capability Pack / AAOP / Runtime 的技术职责固定下来，避免后续 Agent 再次把多个仓库扩成互相竞争的总系统。

## 1. 用户层只有三个产品

```text
Family Space —— 我和家庭
归           —— 我和自己
Ming         —— 我和现实世界
```

三个产品可以独立使用，也可以通过明确授权的 Handoff 接力。它们不是三个 Tab，也不是三个必须完整走完的阶段。

### Family Space

负责家庭关系与真实家庭生活：帮助家庭看见正在发生什么、区分事实与解释、支持可承载行动并从真实生活反馈中修正理解。

### 归

负责个人主体性与成长：情绪、迷茫、方向、学习、练习、意义回望。它不替人决定人生，也不直接拥有真实世界执行控制面。

### Ming

负责“我想让什么在现实里发生”：把人确认过的意图转成 Work Unit，选择合适执行路线，调用能力，读取现实，形成 Evidence，并把最终判断权交还给人。

## 2. Ming Workbench 不是第四个产品

`Ming` 是用户产品；`Ming Workbench` 是 Ming 的控制面与专业工作台形态。

```text
                         Ming
                          │
              ┌───────────┴───────────┐
              │                       │
          简单模式                 Workbench 模式
              │                       │
       小白 / 孩子 / 老师            专业创作者 / 开发者
```

两种模式共享：Intent、Work Unit、Gate、Evidence、Asset、Outcome。

简单模式默认隐藏 Git、AAOP、Harness、Agent、MCP、Provider、Branch、PR、CI 等工程概念；Workbench 模式可以显露这些诊断与控制信息，但它们仍不是用户目标本身。

## 3. Ming 至少有两条执行路线

### 3.1 Creation Route

适用于“从 0 做出一个可见成果”的普通任务，例如：网页、演示、文档、信息图、电子相册、研究整理、数据作品等。

```text
Confirmed Intent
→ Creation Work Unit
→ Capability Provider
→ Execution Runtime
→ Artifact
→ Independent Verification
→ Evidence
→ Human Review
→ Outcome
```

第一阶段优先复用 `Ming-Capability-Pack` + DeepSeek Harness 已有能力，不重复实现宿主、插件市场、通用工具与执行器。

### 3.2 Development Route

适用于已有持续软件项目的开发、修复、迭代与仓库变更。

```text
Existing Project + Intent
→ Development Work Unit
→ AAOP Developer Intake
→ Scope / Grant / Gate
→ Isolated Execution
→ Repository Readback
→ Tests / Verification
→ Evidence
→ Engineering Acceptance
→ Outcome
```

AAOP 只拥有软件开发领域控制语义；它不是 Ming 的总路由器，也不处理所有 Creation Route 任务。

### 3.3 Route 可以演化

一次 Creation 可以长成持续项目：

```text
Creation Artifact
→ 用户决定持续维护/扩展
→ Persistent Project
→ Development Route
```

Ming 不应在第一次做一个简单作品时强迫用户进入软件工程治理。

## 4. 技术职责与 authority

| 层 | 当前仓库/系统 | 责任 | 不拥有 |
|---|---|---|---|
| 原则校准 | `mingos-foundation` | 不可牺牲的生命原则、治理与证据纪律 | 产品 UI、任务执行 |
| 通用协议 | `MingOS` | Actor / Space / Context / Intent / Authorization / Evidence / Handoff / Continuity | Family/归/Ming 的具体产品决策 |
| 家庭产品 | `Family-Space` | 我和家庭 | 个人私密空间、创造总控制面 |
| 个人成长产品 | `Return-to-oneself` | 我和自己 | 真实世界执行 authority |
| 创造产品/控制面 | `Ming-Workbench` | Intent → Work Unit → Route → Reality → Evidence → Outcome | 每种领域的内部实现细节 |
| 方案与交付能力 | `Ming-Capability-Pack` | 某类成果怎样做、怎样验收、怎样交付 | Ming 的总 Intent 与最终 Outcome authority |
| 软件控制协议 | `AAOP` | 软件开发领域 Intake / Authorization / Routing / Engineering Acceptance | 非软件 Creation Route |
| 执行 Runtime | Harness / Codex / Claude / 未来其他 | 真执行 | 最终项目真相与人的决定权 |

## 5. Capability Pack 的收敛边界

Capability Pack 可继续提供：

- recipe / 方案匹配；
- 方案级验收协议；
- SKILL.md 等可移植能力载体；
- 交付体验；
- 执行后验证与证据产出接口。

Workbench 必须拥有：

- 当前用户 Intent；
- 当前 Work Unit；
- 选择 Creation / Development / 未来其他 route；
- Gate 对人的呈现；
- Reality Readback；
- Outcome Truth；
- human acceptance。

长期目标是把 Capability Pack 当作可替换的 `CapabilityProvider`，而不是第二套 Workbench。

## 6. 跨产品 Handoff 原则

默认：Space 隔离。

```text
Family Space context != 归 context != Ming context
```

跨产品信息只能经过用户可见、可编辑、可拒绝的 Handoff。

### 归 → Ming 第一版最小语义

允许传递：

- 用户确认的目标；
- 第一版想得到的 Outcome；
- 为完成该成果真正必要的偏好；
- 用户主动选择的资源；
- 用户明确授权。

默认不传递：

- 无关对话全文；
- 私人情绪历史；
- 与家人的私密讨论；
- AI 未经确认的性格/能力/心理推断；
- 内部阶段标签和风险评分；
- 仅因为“系统知道”而存在的信息。

核心规则：

> AI 知道某条信息，不等于 AI 获得把它带入另一个 Space 的权限。

## 7. 第一条真实闭环

固定第一条跨产品验收场景：

> “我想做一个记录小区流浪猫的网站。”

```text
归
→ 模糊想法逐渐清楚
→ 用户确认“对，我想做这个”
→ 可见的 User-Approved Handoff
→ Ming 接收
→ Creation Work Unit
→ Capability Pack / Runtime
→ 真正生成可打开成果
→ 独立验证
→ Outcome = partial
→ 用户亲自过目
→ 用户接受后 Outcome = completed
→ Return Packet
→ 回到归
→ 回望真实体验与新方向
```

验收重点不是“Agent 能生成 HTML”，而是：

1. 私密上下文没有越权流动；
2. Workbench 没有重新发明 Capability Pack；
3. 简单 Creation 没有被强制升级成 AAOP 软件工程项目；
4. Artifact 真实存在且独立验证；
5. 未经用户验收不得标记 completed；
6. Return 只携带完成回望所需的最小真实信息。

## 8. 第二条真实闭环：存量项目开发

固定专业模式验收：

> “继续开发 `YuemingHub/Family-Space`，先读取当前真实状态，找到当前最值得解决的一个问题，完成并验证。”

应走 Development Route，复用现有 AAOP + isolation + repository readback + verification 链路。

它与第一个场景共同证明：Ming 既能给小白用，也能协助复杂真实项目开发。

## 9. 对 PR #34 的处置

PR #34 不直接 merge，也不整体废弃。

从 current `main` 重建 Stage 3，优先保留：

- confirmed idea → Executable Goal；
- confirmed idea → Work Unit 薄桥；
- Capability Resolution 必须绑定当前 Work Unit；
- Outcome Truth；
- Artifact provenance；
- human acceptance 才能 completed。

不直接保留为总架构：

- “网页/网站/App 关键词 → software_development”作为唯一执行路线；
- 所有简单 Creation 均初始化 Git + AAOP + mutation slice + grant 的重路径。

这些能力保留给 Development Route。

## 10. 当前施工顺序

1. `Return-to-oneself`：User-Approved Handoff V0；
2. `Ming-Workbench`：从 current main 重建 confirmed → Work Unit → Outcome 桥；
3. `Ming-Workbench`：增加 Creation Route；
4. `Ming-Capability-Pack`：先作为 CapabilityProvider 接入，不大重构；
5. 真实跑通“流浪猫网站”闭环；
6. 真实跑通 Family-Space Development Route；
7. 根据真实失败修正；
8. 重复证明后，才决定是否把跨 Space 稳定字段上提 MingOS。

## 11. 明确非目标

本阶段不做：

- 新建第四个用户产品；
- 合并所有仓库为 monorepo；
- 做统一超级 App；
- 扩建新的记忆系统；
- 把 Family Space / 归 私密上下文自动共享给 Ming；
- 让 Capability Pack 成为第二控制面；
- 让 AAOP 接管所有任务；
- 为架构完整提前扩 MingOS Core；
- 建孩子能力评分、人格评分或成长 Dashboard。

## 12. 当前裁决句

> Family Space 帮助一个人和家庭更好地生活在一起；归帮助一个人逐渐回到自己；Ming 帮助这个人把确认过的意图带到现实世界。三者共享底层协议，但不共享未经授权的人生。Ming 的价值不是暴露更多 Agent 技术，而是让普通人和专业用户都能在保持最终决定权的前提下，把真实意图变成有证据的真实结果。
