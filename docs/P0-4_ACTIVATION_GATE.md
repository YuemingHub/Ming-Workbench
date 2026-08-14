# P0-4 Activation Gate — HUMAN_AUTHORIZATION_REQUIRED

**状态：** 本地 packaged proof 已通过；GitHub workflow 激活被凭据 scope 阻止，等待 owner 一次性授权。

**日期：** 2026-08-15
**PR：** #22（Draft），branch `agent/desktop-p0-reconciliation`

---

## 发生了什么

1. 本地打包验证已通过（`scripts/desktop-windows-package-smoke.ps1`，win-unpacked + portable 真实启动、backend-ready、HTTP 200、干净退出、零残留、secret sentinel 不泄漏）——见上一轮 P0-D 证据，本轮以新 exact head 重跑确认中。
2. 尝试把 repository-owned workflow（`workflows.dist/desktop-windows-package-smoke.yml` 的精确内容）激活进 `.github/workflows/` 并 push，GitHub 返回：

```
! [remote rejected] ... (refusing to allow an OAuth App to create or update
  workflow `.github/workflows/desktop-windows-package-smoke.yml` without
  `workflow` scope)
```

这是 GitHub 对缺少 `workflow` scope 的 OAuth token 的固定限制：**创建**或**更新** `.github/workflows/` 下文件都会被拒绝（更新已存在文件同样被拒）。当前分支因此未包含任何 workflow 变更；激活 commit 已从分支撤下，文件保持在本地未跟踪状态，内容与 `workflows.dist/` 完全一致。

## 需要你（owner）做的一次性操作

```powershell
# 1. 给 GitHub CLI token 增加 workflow scope（会打开浏览器确认）
gh auth refresh -s workflow

# 2. 在本仓库根目录，把精确内容放进激活目录并提交推送
git mv .github/workflows.dist/desktop-windows-package-smoke.yml .github/workflows/desktop-windows-package-smoke.yml
git add .github/workflows/desktop-windows-package-smoke.yml
git commit -m "ci(desktop): activate Windows packaged smoke workflow (P0-4)"
git push origin agent/desktop-p0-reconciliation
```

（本地已有一份相同内容的未跟踪文件，直接 `git add .github/workflows/desktop-windows-package-smoke.yml` 也可。）

## 激活后自动发生的事

- 工作流在 **windows-latest** 上运行 `scripts/desktop-windows-package-smoke.ps1`（repository-owned，YAML 只是薄 runner，不复制测试逻辑）。
- 触发条件：PR 涉及 `desktop/**`、`scripts/start-local-web.mjs`、`scripts/desktop-windows-package-smoke.ps1`、`src/web/**`、`src/hosts/**`、`src/persistence/**`、`package.json`、`.workbench/vendor/**` 或 workflow 文件本身。
- 通过标准：package → 启动真实 win-unpacked `Ming Workbench.exe` → `startup.log` backend-ready → loopback HTTP 200 + token meta → clean quit → 零残留进程（PID-tree 跟踪）→ portable 重复一轮 → harness 身份与 `harness.lock.json` pin 一致 → sentinel secret 不泄漏 → 失败上传非敏感诊断。

## 为什么不能由执行工程师绕过

- 凭据没有 `workflow` scope，任何 `push` 含 workflow 文件都会被 GitHub 硬拒（已验证，非猜测）。
- 伪造"已激活"或改在别的仓库跑，不满足 P0-4 的 merge gate："GitHub Windows runner 对新的 exact SHA 真正跑绿"。
- PR #22 在 P0-4 有真实 CI 证据前保持 Draft。

## 我（执行工程师）已经完成的、不需要你的部分

- P0-1 真实 file-bounded `MutationSlice`（exact SHA `87a9ca5` + `ff1c13e`）——151 unit pass，scratch smoke PASS。
- P0-2 四轴状态拆分（`f9fc651`）——CI 三 workflow 全绿，scratch smoke PASS。
- P0-3 completion invariant（`a33fafa`）——CI 运行中。
- 本地 packaged smoke 在新 exact head 重跑（结果见本轮日志）。
- 路线图进度账本已更新（`docs/ZCODE_LONG_TERM_EXECUTION_PLAN.md` §16）。

## 授权后的下一优先级

1. 等 packaged workflow 对 exact head 跑绿 → 若绿，PR #22 四个 P0 merge gate 全部闭合 → owner review/merge。
2. P1-1 `ExecutionRun`（从新 main 开独立分支，不再堆在 PR #22）。
