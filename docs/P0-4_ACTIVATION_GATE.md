# P0-4 Activation Gate — RESOLVED

**状态：** 已解决。workflow 已激活，真实 Windows runner 对 exact head 跑绿。

**日期：** 2026-08-15
**PR：** #22（Draft），branch `agent/desktop-p0-reconciliation`
**exact head：** `b4ae1e5`（全部 CI 绿）

---

## 结果

1. `.github/workflows.dist/desktop-windows-package-smoke.yml` 已移入 `.github/workflows/desktop-windows-package-smoke.yml` 并 push（当前凭据具备 `workflow` scope，与历史上缺失 scope 的记录不同）。
2. 真实 `windows-latest` runner 对 exact head `b4ae1e5` 跑绿：win-unpacked + portable 真实启动、backend-ready、loopback HTTP 200、harness identity 与 `harness.lock.json` 一致、零残留进程、secret sentinel 无泄漏。
3. 期间修复一个真实 smoke 暴露的 bug：electron >= 43 的 npm 包没有 postinstall script，干净 `npm install` 后 `node_modules/electron/dist` 为空，electron-builder 报 `electronDist does not exist`。`scripts/desktop-windows-package-smoke.ps1` 现于构建前运行仓库自带的 `node_modules/electron/install.js`（幂等）确保二进制就绪；workflow 保持薄 runner，不复制测试逻辑。

## 历史记录（保留备查）

最初的激活尝试被 GitHub 拒绝：

```
! [remote rejected] ... (refusing to allow an OAuth App to create or update
  workflow `.github/workflows/desktop-windows-package-smoke.yml` without
  `workflow` scope)
```

那是缺少 `workflow` scope 的 OAuth token 的固定限制。解决后通过 `git mv` 激活并 push。

## 当前状态

- PR #22 四个 P0 merge gate 已全部闭合：
  - P0-1 PASS（MutationSlice / file-bounded mutation，测试绿）
  - P0-2 PASS（run/effect/verification/acceptance 四轴分离，测试绿）
  - P0-3 PASS（completion invariant，测试绿）
  - P0-4 PASS（真实 Windows packaged artifact smoke，CI 绿）
- 本地 153 tests / 151 pass / 2 skip / 0 fail
- PR body evidence 已对齐 exact head `b4ae1e5`

## 剩余

- owner review / merge 决定（PR #22 保持 Draft 待 owner）
- P1-1 `ExecutionRun`（从新基线开独立分支）
