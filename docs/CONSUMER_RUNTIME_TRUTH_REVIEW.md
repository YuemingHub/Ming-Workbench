# Consumer Runtime Truth — 事故复盘与验收基线

Branch: `agent/consumer-runtime-truth` (stacked on PR #23 HEAD `d5c4bd7`)
Base: `desktop-productization@d5c4bd7`

## 真实用户证据（权威级高于任何 CI PASS）

> Ming Workbench 安装包 CI 全绿，但真实安装后"根本用不成"。

CI 全绿掩盖了产品不可用的原因：GitHub Actions runner 预装了
Git / Python / Node / npm / pnpm 并具备完整网络，而真实用户机器没有这些。

## 依赖图

```
INSTALL (NSIS)
  └─ bundled: Electron + .tmp 编译产物 + 16MB git bundle
  └─ external: 无（NSIS 自包含）
      ↓
FIRST LAUNCH (main.mjs)
  ├─ resolveNodeBin: 系统 node → fallback Electron-as-node    [managed]
  └─ prepareHarnessRuntime (harness-runtime.ts)
      ├─ MING_HARNESS_CHECKOUT env                            [dev only]
      ├─ explicit checkout                                    [dev only]
      └─ bundled git bundle:
          ├─ git clone bundle  → 需要系统 Git                  [external!]
          ├─ verifyIdentity    → git rev-parse                [external!]
          └─ installDependencies → pnpm install
              ├─ 需要 Node 运行 pnpm                          [managed via Electron-as-node]
              ├─ 需要 npm registry 网络                       [external!]
              └─ 下载并编译 1.4GB 依赖                        [external!]
      ↓
PROJECT (选择目录)
  └─ git ls-files / rev-parse / status                        [external: Git]
      ↓
AAOP (enableProjectAaop)
  ├─ resolvePromotedAaopStableSource → GitHub API              [external: 网络]
  └─ runCanonicalAaopBootstrap → python bootstrap.py           [external: Python!]
      ↓
HARNESS (ACP transport)
  ├─ 需要 checkout/node_modules/tsx/dist/cli.mjs               [managed once installed]
  ├─ launcher.mjs → app-boot TS 源码                           [bundled source]
  └─ cordis 插件（全部 workspace 包）                           [bundled source + deps]
      ↓
PROVIDER (safeStorage + DEEPSEEK_API_KEY env)                  [user-provided credential]
      ↓
INTAKE → APPROVAL → EXECUTION → VERIFICATION
  └─ 全部经 Harness ACP，不新增外部依赖
```

### 依赖标记

| 依赖 | 类型 | 说明 |
| --- | --- | --- |
| Git | **external prerequisite** | bundle clone + 项目操作 + grant workspace 验证 |
| Python | **external prerequisite** | AAOP canonical bootstrap（普通用户几乎不装） |
| Node | managed | packaged 用 Electron-as-node，不要求系统 Node |
| npm registry | **external (runtime install)** | 首启 pnpm install 下载 1.4GB |
| GitHub | **external (AAOP setup)** | 解析 stable ref + 下载 bootstrap |
| Harness source | bundled (git bundle) | 16MB，需 git clone 解包 |
| AAOP bootstrap | bundled (运行时下载) | 每次 setup 从 GitHub 拉取 |
| provider API | user credential | DeepSeek / OpenAI-compatible |
| safeStorage | managed | Windows DPAPI |
| filesystem perms | managed | per-user 安装 |
| Windows path | managed | 已有 MAX_PATH 缓解 |
| temp/cache | managed | os.tmpdir() |
| child processes | managed | 受控 spawn |

### 结论：一台只有 Windows + 安装包的机器能走到哪一步

今天（PR #23 HEAD）：
1. 安装成功，启动成功（Electron-as-node，无系统 Node 依赖）。
2. `prepareHarnessRuntime` bundled 路径：
   - 无系统 Git → `git clone` 抛 ENOENT → 弹窗"可能需要安装 Git" → 退出。
   - 有 Git 但无网络 → `pnpm install` 失败 → 弹窗 → 退出。
   - 有 Git + 网络 → 下载编译 1.4GB（数分钟到数十分钟，易失败）→ 若成功继续。
3. 项目 onboarding：无 `.aaop` → setup-required。
4. AAOP setup：无 Python → `resolveProjectPythonCommand` 找不到 → `blocked`，产品无法继续。
5. 即使 AAOP 就绪，Harness ACP 运行依赖 1 中安装的 node_modules。

## 本轮验证到的关键事实（真实运行）

| 实验 | 结果 |
| --- | --- |
| 完整 checkout capsule（源码+全量 node_modules+.git，1.5G）解包到独立目录 | **ACP smoke PASS** |
| 源码 + prod-only node_modules + tsconfig + .git（602MB）独立解包 | **ACP smoke PASS** |
| 完整 checkout 压缩体积 | 398MB |
| 源码+prod 组合压缩体积 | **171MB** |
| deploy --prod 闭包（仅依赖，538MB / 压缩 133MB） | 缺源码，launcher 需 TS 源码 |
| Harness 官方 single-exe（`build-exe-for-python-sdk`） | **Windows 是 upstream non-goal**，不可用 |
| AAOP bootstrap.py / install.py | 纯标准库，仅需 CPython 3.11–3.14，无 pip 依赖 |
| Windows embeddable Python (python-3.12.8-embed-amd64.zip) | 11MB，官方分发，可用于受控 AAOP runtime |

## 本轮目标

1. 构建阶段生成 exact-pin Harness runtime capsule；首启只解包/验证/运行，不再 `pnpm install`。
2. AAOP Python 暴露最小化：受控 Python runtime（pin/hash 验证）。
3. Consumer Journey Gate：L3 级真实安装验收。
4. 缺依赖反测试：PATH 无 python/node/npm/pnpm 等。
5. Evidence Claim 等级（L0–L5）固化到文档/CI。

## Evidence Claim 等级

| 等级 | 含义 | 举例 |
| --- | --- | --- |
| L0 | source/unit test | `npm test` |
| L1 | runtime component smoke | harness-acp-smoke (mock LLM) |
| L2 | packaged distribution smoke | NSIS 安装 + 启动 + backend ready |
| L3 | consumer journey E2E | 真实安装 → fresh userData → scratch repo → … → 二次启动恢复 |
| L4 | real provider + real installed product dogfood | 真实 provider key + 已安装产品 |
| L5 | real project achieved outcome + independent evidence | 真实项目达成目标 + 独立证据 |

**L1/L2 PASS 不得写成"产品已经可用"。只有 L3 通过才是 consumer journey 可用的最低证据。**
