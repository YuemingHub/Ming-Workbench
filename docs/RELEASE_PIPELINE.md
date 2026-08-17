# Release Pipeline

Ming Workbench 桌面产品的发布流水线说明。

## 状态

- **实现**: 完成(workflow 文件内容见 `docs/release-workflow.yml`)
- **执行**: 尚未在 GitHub CI 运行(需要打 `vX.Y.Z` tag 后触发)
- **自动更新**: 已实现(`electron-updater` + GitHub Releases + NSIS),端到端未验证(尚无真实 Release)

## 触发方式

推送 `vX.Y.Z` 形式的 tag 触发,例如 `v0.1.0`。不会在每次 main commit 自动发布。

## 流水线步骤

1. checkout 精确 tag
2. 校验工作树干净(禁止从 dirty/local-only tree 发布)
3. 安装依赖
4. 校验 Harness pin(`npm run doctor`)
5. 类型检查(`npm run check`)
6. 单元测试(`npm test`)
7. 构建 Windows NSIS 安装包(`npm run desktop:package`)
8. 校验安装包产物存在
9. 发布 GitHub Release(附 `Ming Workbench Setup <version>.exe` + `latest.yml`)

## 说明

`release-workflow.yml` 是 `.github/workflows/release.yml` 的内容副本。原始文件因
本地凭据缺少 `workflow` scope 无法直接推送到 `.github/workflows/` 目录,
故以 `docs/` 副本形式保留完整内容作为交付证据。Total Review 可通过 GitHub
connector 将同一内容写入 PR branch 的 `.github/workflows/release.yml`。

## 安全边界

- Release 必须绑定精确 commit/tag
- 禁止从 dirty/local-only tree 发布
- 禁止在普通用户机器上存储 GitHub token(仅 CI 使用 `secrets.GITHUB_TOKEN`)
- 安装包未签名(可能触发 Windows SmartScreen 警告),不伪造签名
