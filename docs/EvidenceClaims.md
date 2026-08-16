# Evidence Claim Levels

Ming Workbench 的所有文档、PR、Agent 报告、CI 命名和 release gate 必须明确区分证据等级。禁止把 L1/L2 证据写成"产品已经可用"。

## 等级定义

| 等级 | 含义 | 必须满足 | 典型来源 |
| --- | --- | --- | --- |
| **L0** | source / unit test | 源码级正确性，不涉及运行时 | `npm test`、`npm run check` |
| **L1** | runtime component smoke | 一个运行时组件在真实依赖下工作（可用 mock provider） | `harness-acp-smoke`、`aaop-setup-smoke`、capsule 独立 ACP 运行 |
| **L2** | packaged distribution smoke | 真实打包产物可安装/启动，backend 就绪，runtime 身份正确 | `desktop-distribution-smoke-l2`（NSIS 安装 + 启动 + harness capsule） |
| **L3** | consumer journey E2E | 真实安装后，fresh userData + scratch 项目走通 安装→进入项目→AAOP→provider→intake→Work Unit→关闭→二次启动恢复 | `consumer-journey-gate` |
| **L4** | real provider + real installed product dogfood | 真实 provider 凭据 + 已安装产品完成一轮真实 request | 手动/受控 dogfood |
| **L5** | real project achieved outcome + independent evidence | 真实项目达成目标，且有独立于产品的证据 | 真实交付 + 独立验证 |

## 使用规则

1. **禁止越级声明**：
   - L1/L2 PASS 只能说"组件/分发冒烟通过"，不能说"产品可用"。
   - 只有 L3 通过才是 consumer journey 可用的最低证据。
2. **CI 命名**：workflow 名称必须带等级后缀（如 `-l1`、`-l2`、`-l3`），防止把低等级误当高等级。
3. **fixture vs real provider**：
   - repository-owned 本地 OpenAI-compatible mock 只证明 **product transport**（L1-L3 可以）。
   - 真实 provider 连通性是 **L4**，mock PASS 永远不能伪装成真实 provider PASS。
4. **release gate**：正式发布前必须：
   - L3 `consumer-journey-gate` PASS；
   - L4 真实 provider dogfood 记录（不能只在发布说明里写"未验证"）。
5. **Agent 报告**：每项结论必须标注证据等级，例如 `"capsule 独立运行 ACP (L1, mock LLM)"`。

## 与 CI 的映射

| Workflow | 等级 |
| --- | --- |
| `ci` (unit + typecheck) | L0 |
| `harness-acp-smoke` | L1 |
| `aaop-setup-smoke` | L1 |
| `desktop-distribution-smoke-l2` | L2 |
| `consumer-journey-gate` | L3 |
| release.yml | L2 + L3 + 手工 L4 记录 |

## 当前状态（agent/consumer-runtime-truth @ 2026-08-16）

- L0: 203 tests / 0 fail / 2 skip（仓库内）
- L1: capsule 独立 ACP 运行 mock LLM PASS（`MING_HARNESS_CHECKOUT` 指向解包 capsule）
- L1: bundled Python 被 onboarding 优先解析（真实 venv 模拟）
- L2: 待 Windows CI 运行 `desktop-distribution-smoke-l2`
- L3: `consumer-journey-gate` 脚本就绪，待 Windows CI 运行（依赖真实 GitHub 网络 + mock fixture）
- L4/L5: 未声称
