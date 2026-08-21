# P6.3 — Intent Fidelity Validation

这是一轮验证，不是新的产品架构。它只调用现有的：

```text
普通人的语言
→ synthesizeTurn
→ synthesizeAgreement
→ 一个待人工确认的最小完整 Outcome
```

`intent-fidelity-corpus.json` 只有 5 个案例，输入全部是普通人的表达；
`scripts/validate-intent-fidelity.mjs` 复用现有 HTTP provider seam，并同时
支持 deterministic fixture baseline 与显式 cost-gated real provider。

## 运行

先构建 TypeScript，再跑 fixture baseline；没有真实 provider 凭据时，real
lane 会 fail-closed，不会偷偷产生外部调用：

```powershell
npm run validate:intent-fidelity
```

真实 lane 只有在明确同意外部/付费调用后才会运行。只从环境读取，不把密钥
写入 corpus 或结果：

```powershell
$env:MING_REAL_SYNTHESIS_ALLOW = "1"
$env:MING_REAL_SYNTHESIS_BASE_URL = "https://.../v1"
$env:MING_REAL_SYNTHESIS_API_KEY = "..."
$env:MING_REAL_SYNTHESIS_MODEL = "..."
npm run validate:intent-fidelity
```

也可使用已有的 `MING_L4_*` 或 `DEEPSEEK_*` 环境变量作为 fallback。结果写入
`validation/p6.3/runs/`，每个 case 的 `human_review` 都保持
`HUMAN_REVIEW_REQUIRED`；`final_outcome.verified` 明确为 `false`，因为 P6.3
不执行 Work Unit。

## 人工评价标准

逐案回答以下五项，不能以文字是否漂亮代替：

1. 是否抓住真正问题？
2. 是否理解隐含约束？
3. 是否过度设计？
4. 是否替用户做了不该做的决定？
5. 是否提出了正确需要确认的问题？

评分结果、修正后的 `final_outcome` 和 `correction_count` 应由真人填写；模型
自评不算 Outcome Truth。失败先归类为：A provider/model、B synthesis contract、
C 需要更多上下文、D Outcome schema 不可承载。

三次真实复测的逐案 preliminary 记录见
[`PRELIMINARY_REVIEW.md`](./PRELIMINARY_REVIEW.md)。它只标出需要真人复核的
语义偏移，不代表已完成人工确认。

当前 provider seam 对不可解析响应最多做一次格式恢复；若 provider 返回 429/401，
结果明确记录为外部限流/认证失败，不计入语义质量结论。
