# P6.3 — Intent Fidelity Validation

这是一轮证据 reconciliation，不是新的产品架构。它只调用既有的：

```text
普通人的语言 → synthesizeTurn → synthesizeAgreement → 待人工确认的 smallest outcome
```

Corpus 固定为 `intent-fidelity-corpus.json` 的 5 个普通语言案例，不执行 Work Unit。

## Run

```powershell
npm run validate:intent-fidelity
```

real provider 只有在显式 cost gate 和完整环境变量存在时才调用；结果不写入密钥。
每个结果都分开记录 `protocol_failure` 和 `intent_fidelity_failure`，并保留
`HUMAN_REVIEW_REQUIRED`、`execution_correctness=NOT_RUN`、`convergence_turns`。
每次 provider generation 还记录 `request_index`、phase、system prompt class、
raw response、transport error、`recovery_used`；每个案例保留
`first_raw_response` 与 `recovery_raw_response`，不以 recovery 响应覆盖首次失败。

protocol outcome 只能是：`FIRST_PASS_SUCCESS`、`RECOVERED_SUCCESS`、
`PROTOCOL_FAILURE`。统计按这三个来源分别报告，不合并成一个 usable 数字。

## Human review

`JSON/schema success` 只说明 protocol 可消费，不说明意图正确。人工必须检查是否
出现 invented constraint/resource/cadence/time/tool/willingness、unnecessary narrowing
或 evidence-sufficient non-convergence，并填写 correction / invented-decision 计数。

当前三次历史真实运行的 9/15 protocol-usable 记录和 429 记录已提交；额度恢复后的
同 corpus 三次 recovery re-run 仍是下一实验，未被提前声称完成。
