# HagiCode Electron Demo

一个最小可编译、可打包、可走 GitHub Actions 多平台构建链路的 Electron Demo。

目标不是承载业务功能，而是保留 `hagicode-desktop` 的核心工程结构，作为未来验证 Electron 构建、打包、发布 workflow 的快速通道。

## 结构

- `src/main`：Electron 主进程
- `src/preload`：上下文桥接
- `src/renderer`：React + Vite 首页
- `scripts`：打包辅助、MSIX 组装、签名校验与 smoke test
- `.github/workflows`：PR 校验、入口编排 workflow、平台复用 workflow、Release Drafter

## 常用命令

```bash
npm ci
npm run dev
npm run build:prod
npm run build:linux
npm run build:win
npm run build:win:msix
npm run build:mac:x64
npm run build:mac:arm64
```

## CI 设计

- `pr-checks.yml`：安装、类型检查、生产构建、Linux dir 打包自检
- `build.yml`：Linux / Windows / macOS 按“操作系统 + 包格式”矩阵并行构建
- Windows 目标包含 `portable`、`nsis`、`msix`
- Tag 发布会进入 `production` environment，并发布 GitHub Release
- 也支持手动触发 `production_build=true` 的 production 构建；此时会走 production 签名校验并仅上传 workflow artifacts，不创建 GitHub Release
- 正式 production 构建时：
  - Windows job 使用 `windows-2025` runner；`.exe` 会通过 Azure Artifact Signing v2 严格签名校验，`msix` 会尝试走同一签名链路并在失败时回退为 unsigned
  - macOS 产物在签名材料齐全时会同时产出 signed 与 unsigned 包；如果 production 环境缺少签名或 notarization 要素，会自动回退为 unsigned-only 构建，不阻塞发布链路
  - 已签名的 Windows / macOS 包会和对应的未签名包一起保留；未签名产物会追加 `-unsigned` 后缀，既会出现在 workflow artifacts 中，也会随 tag release 一起上传

## Release 环境变量

正式 tag 发布，以及手动触发 `production_build=true` 的 production 构建，都需要在仓库或 `production` environment 提供以下 secrets：

- Windows 签名：`AZURE_CLIENT_ID`、`AZURE_TENANT_ID`、`AZURE_SUBSCRIPTION_ID`、`AZURE_CODESIGN_ENDPOINT`、`AZURE_CODESIGN_ACCOUNT_NAME`、`AZURE_CODESIGN_CERTIFICATE_PROFILE_NAME`
- macOS 签名证书：`CSC_LINK`、`CSC_KEY_PASSWORD`
  - 如果缺失，production 会回退为 unsigned-only 的 macOS 构建
- macOS notarization：
  - 推荐 API key 方案：`APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`
  - 或 Apple ID 方案：`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`

`msix` 已纳入 Windows 发布矩阵并作为 release artifact 上传。当前 workflow 会在 production 中尝试对 `msix` 执行 Azure Artifact Signing v2；若签名未成功，会自动回退并上传 unsigned MSIX，同时保留 unsigned artifact。

手动 production 构建示例：在 Actions 页面运行 `Build Electron Demo`，将 `production_build` 设为 `true`。这会绑定 `production` environment、执行 production 级签名前置校验，并把产物保留在 workflow artifacts 中。
