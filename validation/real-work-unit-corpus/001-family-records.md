# Real Work Unit Corpus — 001 Family Records

> 第一批真实 Work Unit 验证语料。用已完成的闭环验证 Ming-Workbench 能否处理普通人非技术目标。本记录是未来 Capability Evidence 的种子。

## Original Intent（原始意图）

普通人语言,模糊,未预设技术方案:

> 我只有一点模糊念头。
> 脑子里老有个事,家里那些零碎的,孩子今天说了句啥、要买啥、提醒老人吃药,老忘。想弄个小东西记下来,翻出来就能看。

入口选择:`我只有一点模糊念头`(不是"我已有一个想法")——故意选最模糊的入口,测试 Workbench 能否从零碎片段收敛。

## Human Correction（人需要纠正几次）

1 次。在 Workbench 给出 synthesis 前,人补了一条边界:

> 不用太复杂,就我和家里人能随手记一笔、随时翻看就行,别整成那种要注册要登录的。

意图漂移:无。这条纠正是在 Workbench 主动问之前人自己加的边界,方向与原始意图一致(缩小范围,不是改方向)。Workbench 不需要把人从错误方向拉回。

## Workbench Interpretation（Workbench 解读）

- desiredReality:一个你和家人能随手记下零碎家事、随时翻看的小工具
- strengths(只基于人说过的话):① 痛点已说清——家里零碎事老忘;② 边界已说清——随手记、随时看,不要复杂和注册
- recommendation(一个最小完整真实结果):一个能随手记一条家事、随时翻看列表、关掉再开记录还在的小工具
- agreement.willGet:一个能记、能看、关掉再开记录还在的家庭记录小工具
- agreement.solves:把家里零碎事从"老忘"变成"随手记、随时翻"
- agreement.whereSee:双击打开就能用,不用注册不用安装
- agreement.notDoing:不做账号、不做多设备同步、不做复杂分类

判断:Workbench 没有把模糊念头过度设计成"全家协同平台/知识库/AI 助手",收敛到了一个可验证的最小结果。符合"outcome before architecture"。

## AAOP Route

- situation:`idea`(新想法,无可信实现)
- route:`idea-to-build`
- route_confidence:0.85
- question_needed:null(无 human-owned 待决问题 → 闸门关闭,可进入执行)
- next_action:授权在 `family-records.html` 内创建一个自包含单页(记一条 + 看列表 + 本地持久)

判断:AAOP 没有把一个模糊新想法误判成 `feature-change` 或 `bug-fix`,也没越过人的决定(无强行 route)。闸门逻辑正确:question_needed=null → workUnit.state=ready → 可执行。

## Execution Result

- 在 disposable git isolation 内创建 `family-records.html`(真文件、真改动)
- delta 经隔离→回读→apply 回真实仓库
- runOutcome:`verification=passed` / `effect=mutation-observed` / `acceptance=pending`
- workUnit.state:`verifying`(不冒充 completed)

## Reality Evidence（现实证据）

真实仓库 `git diff -- family-records.html`:
```
-<!-- placeholder -->
+<!DOCTYPE html>
...
+<title>家庭记录</title>
+... localStorage ...  id="form" ...
```

证据:
- 1 条权威 evidence(`test-run` + `verification=passed`)——由真实仓库回读产生
- 1 条非权威 evidence(`harness-session` + `pending`)——run 记录,不能背书完成
- 1 条非权威 intake evidence(`session`)——AAOP 协调记录

可独立观察:产物文件 = 一个真能用的家庭记录单页(添加/列表/删除/localStorage 持久),非占位、非伪代码。

## Human Satisfaction

模拟判定:**满意**。产物直接可用、符合 agreement.willGet、未超出 notDoing 边界。但需诚实标注:此判定是代笔,非真实用户。

## Failure Reason

无硬失败。闭环跑通,产物真实。

---

## 诚实声明:什么是真实的,什么是模拟的

本案例用当前 harness double 跑通。3 个"智能"环节被代笔/双替:

| 环节 | 状态 | 说明 |
|---|---|---|
| Workbench Outcome(synthesis) | **代笔** | `src/idea/synthesis.ts` 需真实 provider 才能从模糊意图生成 synthesis;无注入 seam。本案例手工构造 synthesis 对象,绕过 provider 调用。 |
| AAOP Intake(coordinator) | **double** | envelope 由 `createCoordinatorDouble` 代笔(经真实 `parseAaopIntakeEnvelope` 校验 + 真实 `reconcileAaopCoordinatorWorkUnit` 回写)。 |
| Harness Execution | **double** | grant-run double 在隔离 worktree 内真写文件(真改动、真回读、真 evidence);但产物内容由代笔决定。 |

其余全部真跑:onboarding / 真实 AAOP bridge 子进程 / grant issuance / mutation slice / disposable git isolation / repository readback / runOutcome / evidence 派生。

## 发现与阻塞(分类)

### Workbench 侧

- **[发现,非阻塞] idea-space synthesis 无注入 seam**:`src/idea/synthesis.ts` 直接调 provider,无 `dependencies` 注入点。要做真实用户模糊意图验证,要么接真实 provider,要么给 synthesis 加一个注入 seam(像 intake/coordinator 那样)。这是"用 double 完整测一个真实用户意图"的唯一 Workbench 侧缺口。
- **[发现,非阻塞] HTML/非代码产物的验证偏弱**:scratch 无 package.json → `runProjectTests` 返回 null → 验证靠仓库回读(只证"文件变了",不证"工具真能用")。未来可把一个 Playwright smoke 作为 `testCommand`,获得真实 `test-run` evidence 证明工具功能。本轮按"不新增基础设施"约束未做。

### Development Control(AAOP)侧

- **[发现] AAOP 够用**:对模糊新想法,`idea`/`idea-to-build` 路由 + question_needed 闸门 + 不越过人决定,全部正确。**不改 AAOP**。

### Execution(Harness adapter)侧

- **[发现] adapter 够用**:grant/slice/isolation/readback/evidence 对非代码(HTML)产物同样成立。**不改 Harness adapter**。

## 结论

P6.1 回答了"链路能否承载一个非技术模糊意图":**能**。从"家里零碎事老忘"到真实可用的家庭记录单页,链路形态正确、收敛克制、证据诚实。

但 P6.1 **没有**回答"真实人的模糊意图能否被 LLM 理解"——因为 3 个智能环节被代笔/双替。要回答后者,下一步最小动作是:给 Workbench Outcome 的 synthesis 接一个真实 provider(或加注入 seam 接一个 synthesis double),先用"真实 synthesis + 仍 double 的 coordinator/execution"隔离出 Workbench Outcome 阶段的真实性,再逐步换真实 transport。

**本案例未触发任何代码修正**(约束:只有发现阻塞才改代码)。上述两项 Workbench 侧发现均为"非阻塞",记入语料待后续阶段处理。
