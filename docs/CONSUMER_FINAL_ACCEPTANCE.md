# Consumer Runtime Truth — 最终验收

Branch: `agent/consumer-runtime-truth`
Draft PR: #24 (base → `desktop-productization@d5c4bd7`)
Head: 见 CI 记录（exact SHA 在下方每项标注）

> 第一行必须回答：**TRUE CONSUMER L3: PASS / FAIL**（由 `consumer-human-journey-l3` 决定）。

## 一、Fresh Windows 用户还需要自己安装什么？

| 依赖 | 安装后还需要用户装吗 | 状态 |
| --- | --- | --- |
| Git | **是（唯一外部 prerequisite）** | 明确、可检测、可解释：`git-prerequisite.ts` + UI 提示 + `/api/project` 返回 git 状态 |
| Python | 否 | bundled（`prepare-python-runtime.mjs`，Windows embeddable 3.12.10，SHA-256 验证） |
| Node | 否 | packaged 用 Electron-as-node |
| npm | 否 | 不执行 npm install |
| pnpm | 否 | 不执行 pnpm install |
| Harness | 否 | prebuilt capsule（`build-harness-capsule.mjs`，646MB unpacked / ~171MB 压缩） |
| AAOP | 否 | canonical bootstrap 由 bundled Python 运行 |

目标达成：**Ming Workbench + Git repository + provider credential**。

## 二、安装后是否执行 dependency installation？

**否。** 首次启动 `prepareHarnessRuntime` 命中 `bundled-capsule` 路径：
- 只做 SHA-256 身份验证（纯 Node fs+crypto，无 git/pnpm/网络）；
- 直接运行 capsule 内的 tsx + app-boot。
不再 `pnpm install`。验证：`consumer-missing-deps-test.mjs`（隔离 consumer PATH，7 个 dev 工具全移除）PASS。

## 三、一个没有 `.aaop` 的新 repository，能否完全通过产品路径启用？

- 产品代码路径：`/api/setup` → `enableProjectAaop`（bundled Python 优先）→ canonical AAOP bootstrap → `.aaop` 出现 → onboarding ready。
- 本地沙箱因 GitHub API 403（限流）无法跑通完整 setup；CI（真实 GitHub 网络）验证。
- bundled Python 解析优先已用真实 venv 模拟验证 PASS（`resolveProductPythonCommand` 返回 bundled 路径）。

## 四、Consumer Journey Gate 是否通过？

- **L2 `desktop-distribution-smoke-l2`**：Windows CI 运行（NSIS 安装 + 启动 + capsule 身份）。
- **L2+ `packaged-application-pipeline-smoke`**：installed shell + backend 管线（直接 API，非 UI）。**不得写成 L3**。
- **L3 `consumer-human-journey-l3`**：真实 UI 驱动（CDP），canonical task = README Version: OLD → NEW，独立观察 README + git diff。
- exact commit / workflow / artifact/log 见 CI。

## 五、哪些东西仍然没有证明？

- 真实 provider（L4）dogfood。
- L5 真实项目达成 + 独立证据。
- Windows 上 bundled Python 跑完整 AAOP（本地 403 限制，CI 验证中）。
- L3 完整 UI journey 通过（CDP 驱动 installed EXE，CI 验证中）。
- 真实 NSIS installer 体积 / installed size / 首启/次启时间（CI artifact 测量）。

## 关键测量（Linux 沙箱）

| 项 | 值 |
| --- | --- |
| Harness capsule unpacked | 646 MB |
| Harness capsule compressed | ~171 MB |
| bundled Python | 25 MB (POSIX venv 模拟; Windows embeddable ~11MB) |
| capsule 身份验证 | 6 个 key file SHA-256 |
| reality-loop 执行 | README OLD→NEW，git diff 独立观察，verification passed，Work Unit verifying（本地 PASS） |

## Evidence

- L0: 203 tests / 0 fail / 2 skip
- L1: capsule 独立 ACP run PASS (mock LLM)
- L1: bundled Python onboarding 优先 PASS
- L2+ execution: `smoke-reality-loop-execution` PASS（真实 Harness ACP write 隔离执行）
- L2/L2+/L3: 见 GitHub Actions（exact SHA）

## 2026-08-20 canonical Windows packaging repair

This addendum records the current local delivery truth without creating a new
packet. Before the repair, the repository's declared packaging path was not
green:

```text
LOCAL ENGINEERING: PARTIAL — canonical desktop packaging command fails
```

The exact call chain was `npm run desktop:package` → `build:test` →
`packaged:runtime:prepare` → `python:prepare` → `harness:prepare` →
`build-harness-capsule.mjs` → `npx.cmd pnpm@11.7.0 ... deploy --legacy --prod`
→ source-tree copy → archive → `electron-builder --win --publish never`.
The `pnpm deploy` child returned zero. The failure was the following
unfiltered `fs.cpSync` source-tree copy on a pnpm checkout containing Windows
junctions; Node 24.19.0 terminated with `3221226505` (`0xC0000409`, Windows
fail-fast / stack-buffer-overrun status). The script now filters nested
`node_modules`, `.git`, and symlink/reparse entries while retaining the
existing hoisted production closure and single-file archive carrier.

Harness remains required for the confirmed execution path. The repaired
canonical installer carried the archive and passed the installed own-key
journey with `MING_EXECUTION_FIXTURE=1`: fresh install and userData,
human-first entry, UI provider configuration, deterministic provider-backed
conversation, confirmation and cost gate, one terminal outcome, artifact
opened, clean close, same-userData reopen, key removal/provider-required
reassertion, sentinel scan, and uninstall.

Current local delivery status after the repair:

```text
LOCAL ENGINEERING: PASS
INSTALLED REALITY: PASS
CAPABILITY ASSESSMENT: PASS
EXTERNAL DISCOVERY: NOT REQUIRED
EXECUTOR PORTABILITY: NOT PROVEN
REAL PROVIDER: NOT RUN — HUMAN COST GATE
REAL HUMAN L5: NOT PROVEN
WINDOWS SYMLINK ADVERSARIAL: NOT RUN — ENVIRONMENT PRIVILEGE
REMOTE CI: STALE / PENDING PUSH AUTHORIZATION
```

Canonical installer evidence (local only; not a release):

- command: `npm run desktop:package` (exit code 0)
- local commit: `6ea65b84ca72584fc89c9cdcf6f4e0264a59cc51`
- installer: `dist-desktop/Ming Workbench Setup 0.1.0.exe`
- SHA-256: `83E6404A7488645D480809A267E4391E70541AB755FCC520526511E249342E7B`
- size: `200722981` bytes
- timestamp (UTC): `2026-08-20T14:49:53.6862547Z`
- installed smoke evidence: `D:\Oh-my-AI\Ming-workbench-packaging-smoke-evidence-20260820-retry`

Verification: `npm run check` PASS; `npm test` PASS (226 passed, 3 skipped,
0 failed); `npm run credential-scan` PASS. No push, merge, tag, or release was
performed.

## 2026-08-21 Outcome Truth correction and canonical installer revalidation

Total Review found that the previous installed journey could report a changed
`README.md` while opening the pre-execution `index.html`. That was not Outcome
Truth: artifact existence had been mistaken for execution provenance.

The correction is intentionally thin:

- the installed deterministic own-key fixture now writes the exact `index.html`
  target that the result opens;
- `executeFirstOutcome` records the execution-produced file, granted-slice
  membership, and SHA-256 before/after hashes, and exposes an artifact only
  when the current run produced that file and changed its bytes;
- result opening uses a separate Electron `BrowserWindow` with a `file://`
  artifact origin, no Workbench preload, no privileged IPC, and no control
  origin `/result` route;
- the installed artifact was exercised as a daily-notes page: input → save →
  rendered entry → reload → entry persists. Control API fetch, request-token
  markup, and privileged IPC were adversarially checked and denied.

Current local delivery status after the Outcome Truth correction:

```text
LOCAL ENGINEERING: PASS
INSTALLED REALITY: PASS
CAPABILITY ASSESSMENT: PASS
EXTERNAL DISCOVERY: NOT REQUIRED
EXECUTOR PORTABILITY: NOT PROVEN
REAL PROVIDER: NOT RUN — HUMAN COST GATE
REAL HUMAN L5: NOT PROVEN
WINDOWS SYMLINK ADVERSARIAL: NOT RUN — ENVIRONMENT PRIVILEGE
REMOTE CI: PENDING EXACT-HEAD REVALIDATION
```

Canonical installer evidence (local only; not a release):

- command: `npm run desktop:package` (exit code 0)
- installer: `dist-desktop/Ming Workbench Setup 0.1.0.exe`
- SHA-256: `2E5F668DA3CADAD5F2A2A41152B9564361837A00E76E0F5F475825405C160AF0`
- size: `200750968` bytes
- timestamp (UTC): `2026-08-21T00:35:43.1145396Z`
- installed own-key evidence: local temporary `own-key-af0a40e7` run (not tracked)
- packaged smoke evidence: local temporary `mwps-ec55682f` run (not tracked)

Verification: `npm run check` PASS; `npm test` PASS (226 passed, 3 skipped,
0 failed); `npm run credential-scan` PASS; static adversarial audit includes
artifact-runtime isolation; canonical win-unpacked and NSIS packaged smokes
PASS. The Stage 3 transport/readback slice records `index.html` production;
its optional xvfb browser substep remains Windows-unavailable and is not
promoted to stronger evidence.
