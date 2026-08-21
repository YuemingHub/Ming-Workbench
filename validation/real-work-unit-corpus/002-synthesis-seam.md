# Real Work Unit Corpus — 002 Synthesis Seam Validation

> 验证 Human Intent → Workbench Outcome 阶段的真实智能边界。本案例**不新增产品目标**(沿用 corpus 001 的家庭记录意图),只验证 synthesis provider 现在可被替换。

## 触发改动

`src/idea/synthesis.ts` 增加最小 provider injection seam:
- `SynthesisProvider` 接口:`{ complete(systemPrompt, userContent): Promise<string> }`
- `createHttpSynthesisProvider(endpoint)`:默认 HTTP 实现(包装既有 `callChatCompletions`,行为不变)
- `synthesizeTurn(endpoint, idea, provider?)` / `synthesizeAgreement(endpoint, idea, provider?)`:增加可选 `provider` 参数;注入则用之,否则走 HTTP(默认),否则降级到无 provider 回复

未改动:`IdeaSynthesis` / `RoundAgreement` schema、`HumanFirstIdea` 状态机、`WorkUnit`、orchestrator、intake、execution、evidence。HTTP 路径行为逐字保持不变(idea-space.test.mjs 的 mock-server HTTP 测试 6/6 仍过)。

## raw intent（原始意图，普通人模糊语言）

> 我只有一点模糊念头。
> 家里那些零碎的，孩子今天说了句啥、要买啥、提醒老人吃药，老忘。想弄个小东西记下来。

## human correction（人的边界纠正，1 次，方向一致）

> 不用太复杂，随手记一笔、随时翻看就行，别整成要注册的。

意图漂移:无。纠正只缩小范围,不改方向。

## synthesis result（现在来自注入的 provider，不再手写）

注入 deterministic provider(扮演"一个正确的 LLM"),经**真实** `synthesizeTurn` 调用产生:

- desiredReality:一个你和家人能随手记下零碎家事、随时翻看的小工具
- strengths(只基于人说过的话):① 痛点已说清——家里零碎事老忘;② 边界已说清——随手记、随时看,不要复杂和注册
- recommendation:一个能随手记一条家事、随时翻看列表、关掉再开记录还在的小工具

agreement 经**真实** `synthesizeAgreement` 调用产生(同 provider):
- willGet:一个能记、能看、关掉再开记录还在的家庭记录小工具
- solves:把家里零碎事从"老忘"变成"随手记、随时翻"
- whereSee:双击打开就能用,不用注册不用安装
- notDoing:不做账号、不做多设备同步、不做复杂分类

与 corpus 001 手写的 synthesis 内容一致——证明 deterministic provider 忠实扮演了"正确 LLM"。

## final outcome（闭环结果，与 corpus 001 逐字一致）

- AAOP:situation=`idea` / route=`idea-to-build` / question_needed=null → 闸门关
- 执行:disposable isolation 内真创建 `family-records.html`(真实文件改动)
- runOutcome:`verification=passed` / `effect=mutation-observed` / `acceptance=pending`
- workUnit.state:`verifying`(不冒充 completed)
- 真实 `git diff`:placeholder → 完整家庭记录单页
- evidence:1 权威(test-run,passed)+ 2 非权威

闭环逻辑**未改任何一行**——coordinator/execution 仍是 corpus 001 的同一套 double,产出一致。唯一变化:synthesis 来源从"手写对象"变成"注入 provider 经真实 synthesizeTurn"。

## 验证证据

| 测试 | 文件 | 结果 |
|---|---|---|
| synthesis provider 契约(deterministic/mock/failure/降级) | `test/synthesis-provider.test.mjs` | 5/5 |
| HTTP 路径未破坏 | `test/idea-space.test.mjs` | 6/6 |
| 注入 provider → 闭环不变 | `test/real-work-unit-corpus-002.test.mjs` | 1/1 |
| 全套件回归 | `test/*.test.mjs` | 240 tests, 238 pass, 0 fail, 2 skipped |

## 诚实声明:本案例什么是真实的

| 环节 | 状态 | 说明 |
|---|---|---|
| Workbench Outcome(synthesis) | **注入 deterministic provider(可替换)** | 经真实 `synthesizeTurn`/`synthesizeAgreement` 调用;provider 本身是确定性的扮演,非真实 LLM |
| AAOP Intake(coordinator) | **double** | 不变 |
| Harness Execution | **double** | 不变 |

**进展**:相对 corpus 001,Workbench Outcome 阶段从"完全手写、无 seam"变成"可注入 provider、经真实代码路径"。这是验证 synthesis 真实智能的必要前置——现在替换成真实 LLM 只需注入一个真 provider,无需改 Workbench 任何逻辑。

## 验收回答

> **"我们现在是否可以替换 synthesis provider，而不改变 Workbench 逻辑？"**

**是。**

证据:
1. `synthesizeTurn`/`synthesizeAgreement` 现在接受可选 `SynthesisProvider` 参数;注入即生效,不注入则走原 HTTP 路径(逐字不变)。
2. corpus 002 用注入的 deterministic provider 经**真实** `synthesizeTurn`/`synthesizeAgreement` 构建 idea,再喂给**未改一行**的闭环,产出与 corpus 001 逐字一致。
3. 契约测试覆盖:deterministic(就绪+synthesis)、mock(就绪状态迁移)、failure(错误传播不被吞)、无 provider 降级(HTTP 默认保持)。
4. WorkUnit 真源不变、schema 不变、无新增 framework/memory/agent。

替换成真实 LLM 的下一步最小动作:实现一个 `SynthesisProvider`,其 `complete` 调真实 `/chat/completions`(或复用 `createHttpSynthesisProvider` 给真实 endpoint),注入即可——无需碰 Workbench 逻辑。

## 阻塞与修正

无阻塞,未触发下游代码修正。Workbench Outcome 侧 seam 已补齐。

## 下一步候选(不在本案例范围)

- 真实 LLM synthesis 验证:注入真 provider,跑一个真实人的模糊意图,观察 synthesis 是否接地、是否过度设计。
- AAOP coordinator 的真实 LLM seam(目前 coordinator 仍只能 double)——但按约束本轮不动。
