# Ming Workbench P0.6 交付说明（2026-08-16）

本轮目标：把"技术已经存在但 owner 打开后无法开始使用"的桌面产品，修成**第一次打开就知道怎么用**的产品。以下所有结论都有真实证据，不引用任何未验证的 PASS。

## 一、owner 遇到的问题（真实复现）

owner 安装 Preview2 后看到：顶部长期"正在准备…"、"还没有选择项目"、页面要求选择项目但**没有任何按钮**、输入区不可用。

在 exact head `8e6ff46` 上用 4 种启动状态复现（全新用户 / 有 lastProject / lastProject 失效 / 旧 preview 残留），并用 CDP 连进真实 packaged 渲染进程取证，找到**三层叠加的根因**：

1. **渲染 JS 从未执行**：`local-ui.ts` 模板字符串里的 `'\n'` 在构建时被解释成真实换行，生成的 `app.js` 第 185 行字符串字面量跨行 → SyntaxError。此前的"UI PASS"全是字符串级检查，从未证明 JS 真的跑过。
2. **即使 JS 跑了，两个项目按钮也永远隐藏**：初始 `hidden` 且没有任何渲染路径移除它。
3. **renderGate 空节点崩溃**：`renderProject` 清空项目卡时把 `project-empty-text` 一起删掉，后续 `classList` 访问 null 抛 TypeError，就绪状态条永远停在"正在准备…"。

旅程验证中还发现第 4 个真实 bug：**保存 AI 配置后窗口重载死端口**（backend 重启换端口，`reload()` 加载旧 URL → chrome-error 错误页）。

## 二、修复内容

| # | 问题 | 修复 |
|---|------|------|
| 1 | app.js SyntaxError | 模板内 `\n` 转义修复；`new Function()` 全量解析作为回归门 |
| 2 | 项目按钮永不出现 | `renderProjectButtons` 硬性不变量：无项目必有可见 [选择项目]；有项目显示名称+完整路径+[更换项目] |
| 3 | 就绪条死在"正在准备…" | 空节点保护 + `/api/project` 返回真实 `projectPath` |
| 4 | 保存配置后错误页 | 重启后 `loadURL(新端口)` 替代 `reload()` |
| 5 | 60 秒静默准备 | 欢迎页选择后立即提示"第一次约需 1 分钟，请勿关闭窗口" |
| 6 | AI 状态不诚实 | 五态模型：未配置 / 已配置待测试 / 测试中 / 连接成功 / 失败。有密钥绝不等于已连接，只有真实 provider round trip 通过才显示 🟢 |
| 7 | 主页像工程面板 | 只保留三件事：当前项目、AI 状态、你想做什么；Git/Harness 等诊断收进"更多信息" |
| 8 | Base URL 假功能 | 运行时并未使用它——从 owner UI 移除，不撒谎 |
| 9 | 死页兜底 | 15 秒未完成启动 → 显式"Workbench 没有完成启动"+ 重新加载/重新选择项目 |
| 10 | 模型/密钥无从下手 | 模型输入带真实建议（deepseek-v4-pro / deepseek-chat，可自由填写）；API Key 提示去 platform.deepseek.com 创建；输入框占位文案按状态给出唯一下一步 |

## 三、验证证据（全部真实执行）

- **单元/契约（L1）**：`npm run check` 干净；188 项测试 185 pass / 2 skip / 1 fail（唯一失败是本机无符号链接权限的环境性 EPERM，在未改动的旧测试上同样失败，GitHub runner 不受影响）。
- **packaged 渲染进程（L2，CDP 实测）**：app.js 解析通过、零 console error；欢迎页按钮真实可见可用；有项目时 [更换项目] 可见、项目名+完整路径渲染、状态条正确显示"需要配置 AI"。
- **安装版 owner 旅程（L3，NSIS 真实安装）**：
  - 首次启动 → 欢迎页 + 明显 [选择项目]（截图 screen-A）
  - 点击 → **native 文件夹选择器真实打开**（窗口枚举 `#32770` 实证 + 截图）
  - 选择后 → 项目名 `repo` + 完整路径显示（screen-B）
  - 配置面板可用，模型改成 `deepseek-chat` 保存成功（screen-C），页面正确进入新 backend
  - 无密钥时测试连接 → 诚实提示"请先保存 API Key"（screen-D，本机无真实密钥，不伪造连接成功）
  - 关闭重开 → 同一项目 + 模型配置自动恢复，无密钥显示"未配置"而非虚报（screen-E）
  - 项目目录被移走 → 重启自动回到欢迎页，无死页/崩溃
- 安装包：桌面 `Ming-Workbench-v0.1.0-preview4.exe`（121,386,910 字节，与本次构建 MD5 一致）。

## 四、普通用户使用路径（现在的产品）

1. 双击安装包安装，打开 Ming Workbench
2. 看到"先选择一个项目"→ 点 [选择项目] → 在弹出的窗口选你的项目文件夹（第一次准备约 1 分钟）
3. 进入主页后点 [配置 AI] → 模型选/填（如 deepseek-chat）→ 粘贴 API Key（platform.deepseek.com 创建）→ 保存
4. 点 [测试连接] → 看到"🟢 连接成功"
5. 在"你现在想做什么"输入一句话（如"看看这个项目做到哪了，接下来先做什么"）→ 点 [开始理解]（只读，不改文件）
6. 之后按页面指引确认/执行，所有修改都会先征求你的同意

## 五、安全边界（保持不变）

密钥仅存于系统安全存储（safeStorage），永不回显/落项目/进日志；渲染进程无文件系统与执行权限；执行仍需人工批准；未知修改范围一律拒绝；Work Unit 执行期间不自动更新。

## 六、本轮提交

- `f7f641f` fix(desktop): make first owner journey actually usable（P0.6 主修复）
- 后续 UX 打磨提交（见 git log）

已推送 `desktop-productization` 分支（PR #23）。未 merge、未打 tag、未发 Release，等待 Total Review。

## 七、自定义模型服务（追加轮）

owner 要求：除了 DeepSeek，还能用任何 OpenAI 接口兼容的模型服务。

**实现**：AI 配置面板新增「模型服务」选择——`DeepSeek 官方` / `自定义（OpenAI 接口兼容）`。选自定义时出现 Base URL 输入框；模型名保持自由填写（带常用建议）。自定义模式会把 `DEEPSEEK_BASE_URL` + 保守的兼容参数（thinking 关闭、reasoning effort 省略、max_tokens 16384）注入 Harness ACP 环境；官方模式完全保持 DeepSeek 原参数。底层零新增架构——复用 bundled Harness 的 OpenAI chat/completions 插件。

**真实验证**（用你提供的两个服务 + 真实 key，全程走产品 UI，CDP 驱动）：
- SenseNova（`token.sensenova.cn` + `sensenova-6.8-flash-lite`）→ 🟢 连接成功
- StepFun（`api.stepfun.com/step_plan/v1` + `step-3.7-flash`）→ 🟢 连接成功
- 连接成功后就绪门打开，真实只读 intake 调用返回模型决策并渲染到页面
- 中途真实修了三个兼容性问题（凭真实服务端错误信息逐步收敛）：`reasoningEffort: max` 非第三方合法值 → 自定义模式置 off；插件要求 thinking 关闭时 effort 必须 off；`max_tokens` 默认 256000 超 SenseNova 65536 上限 → 自定义模式 16384。

**使用**：配置 AI → 选「自定义」→ 填接口地址（如 `https://token.sensenova.cn/v1`）→ 填模型名 → 填该服务商给你的 API Key → 保存 → 测试连接。
