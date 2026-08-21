# P6.3 真实案例 preliminary review

状态：`CODEX_PRELIMINARY_ONLY`。这不是 Reality Owner 的最终确认；每案仍保持
`HUMAN_REVIEW_REQUIRED`，也没有执行 Work Unit。

依据：三次同配置 real provider runs：

- `p6.3-2026-08-21T12-10-42-441Z.json`：2/5 usable，3 A；
- `p6.3-2026-08-21T12-14-51-428Z.json`：4/5 usable，1 A；
- `p6.3-2026-08-21T12-18-05-080Z.json`：3/5 usable，2 A。

三次共 15 次 case attempt，9 次同时得到 synthesis + agreement，6 次因 provider
输出未满足现有 JSON contract 归为 A。失败的 case 在不同轮次变化，说明稳定性
尚未达到可直接进入 Harness 的程度。

| case | 抓住真正问题 | 隐含约束 | 过度设计 / 未授权决定 | 正确确认问题 | 当前分类 |
| --- | --- | --- | --- | --- | --- |
| daily-overload | 是 | 基本是 | 部分：擅自收窄为“3 件事”“连续 3 天” | 不足：没有确认何谓最重要、提醒方式 | none（latest） |
| morning-preparation | 是 | 是 | 部分：加入“3–5 项、图画、书包/水壶/口罩”等未提供细节 | 不足：没有确认清单内容与孩子能接受的方式 | A（latest） |
| recipe-finding | 是 | 是 | 基本不过度；“手机备忘录/固定位置”仍需确认 | 不足：没有确认先整理哪些菜、需要哪些信息 | A（latest） |
| family-photo-weekend | 是 | 是 | 部分：加入共享相册、链接、家庭群，提前做了可见范围决定 | 不足：没有确认谁能看到、在哪里打开 | none（latest） |
| weekly-home-rhythm | 是 | 是 | 部分：擅自规定 3 件、冰箱/门口、每周更新 | 不足：没有确认谁维护、哪些事最要紧 | none（latest） |

这些判断只用于指出下一步审阅重点，不替代人工接受或修正。若 Reality Owner
对任一项说“不对”，应记录 correction_count 并把失败归类后再决定是否修复。

## 有界 provider recovery

针对 A 类“输出不是可解析 JSON”，现有 provider seam 增加了最多一次格式恢复
请求；无效响应仍回到原 fallback，不改变 schema 或对话状态。两个本地回归用例
通过。真实复验 run `12-29-09` 全部收到 provider `429`，因此没有把它当作语义
改善或退化证据；需要额度恢复后再做同一 corpus 的 real reverify。
