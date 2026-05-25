# HagiCode Electron Demo

一个最小可编译、可打包、可走 GitHub Actions 多平台构建链路的 Electron Demo。

目标不是承载业务功能，而是保留 `hagicode-desktop` 的核心工程结构，作为未来验证 Electron 构建、打包、发布 workflow 的快速通道。

## 结构

- `src/main`：Electron 主进程
- `src/preload`：上下文桥接
- `src/renderer`：React + Vite 首页
- `scripts`：打包辅助与 smoke test
- `.github/workflows`：PR 校验与多平台构建

## 常用命令

```bash
npm ci
npm run dev
npm run build:prod
npm run build:linux
npm run build:win
npm run build:mac:x64
npm run build:mac:arm64
```

## CI 设计

- `pr-checks.yml`：安装、类型检查、生产构建、Linux dir 打包自检
- `build.yml`：Linux x64 / Windows x64 / macOS x64 / macOS arm64 构建并上传产物
- Tag 构建会自动汇总 artifact 并创建 GitHub Release
