# P6.3 preliminary human review

状态：`CODEX_PRELIMINARY_ONLY`。所有案例仍为 `HUMAN_REVIEW_REQUIRED`；模型输出和
execution self-report 都不是 Intent Truth。

## Historical real-provider protocol evidence

同一 5-case corpus 的三次 real runs：

| run | protocol success | `PROTOCOL_FAILURE` | intent/convergence candidate |
| --- | ---: | ---: | ---: |
| `12-10-42` | 2/5 | 0 | 3 |
| `12-14-51` | 4/5 | 1 | 0 |
| `12-18-05` | 3/5 | 2 | 0 |
| 合计 | 9/15 | 3 | 3 |

`12-29-09` 是 5/5 `429`，单独归为 `PROTOCOL_FAILURE/provider_rate_limit`，不计入
intent fidelity。以上把 protocol consumption 与 convergence candidate 分开，
不是 semantic pass rate。

## Required correction marks from existing remote outputs

### `reading-notes`

输出未经用户授权补入：

- 每天 10 分钟；
- 连续 7 天；
- 至少 7 条；
- 手机备忘录；
- 「愿意从小事开始尝试」。

这些属于 invented cadence/time/resource/willingness；人工应要求用户 correction，
不能标记 Intent PASS。

### `family-records`

用户已经提供足够信息形成 provisional smallest outcome，但 provider 连续三轮
保持 `ready=false`，属于 `INTENT_FIDELITY_FAILURE/convergence_failure`。执行末端
即使显示 `verification=passed`，也只说明 execution correctness，不改变 Intent
correctness 的失败/待修正结论。

## Review table for P6.3 five cases

| case | protocol result | intent result | human action |
| --- | --- | --- | --- |
| daily-overload | per-run | `HUMAN_REVIEW_REQUIRED` | 确认“最重要”和提醒方式，不让模型代定优先级 |
| morning-preparation | per-run | `HUMAN_REVIEW_REQUIRED` | 检查孩子自用边界，拒绝未经授权的奖惩/监控 |
| recipe-finding | per-run | `HUMAN_REVIEW_REQUIRED` | 确认先整理哪些菜、要看哪些信息 |
| family-photo-weekend | per-run | `HUMAN_REVIEW_REQUIRED` | 确认可见范围和打开位置，不默认公开/上传 |
| weekly-home-rhythm | per-run | `HUMAN_REVIEW_REQUIRED` | 确认最要紧事项和维护意愿，不分配家庭责任 |

## Next experiment gate

额度恢复前不新增 corpus、不换题、不改人工 baseline。恢复后同一 5-case corpus 至少
重跑 3 次，并独立报告 protocol success rate、intent fidelity、human correction
required、invented decisions count、convergence turns。完成前不进入真实 Harness。
