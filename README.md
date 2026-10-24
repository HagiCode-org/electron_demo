# HagiCode Electron Demo

[![release](https://img.shields.io/github/v/release/HagiCode-org/electron_demo)](https://github.com/HagiCode-org/electron_demo/releases)
[![build](https://img.shields.io/github/actions/workflow/status/HagiCode-org/electron_demo/build.yml?branch=main&label=build)](https://github.com/HagiCode-org/electron_demo/actions/workflows/build.yml)

A minimal Electron demo that compiles, packages, and runs through a GitHub Actions multi-platform build pipeline.

The goal is not to carry business logic, but to preserve the core engineering structure of `hagicode-desktop` and serve as a fast lane for validating Electron build, packaging, and release workflows. It is internal tooling for the maintainers and testers of the HagiCode desktop app, not an end-user product.

## What You Can Verify

- Installable packages build and run on each platform:
  - Linux: `AppImage`, `deb`, `rpm`, `tar.gz`, `zip`
  - Windows: `portable`, `nsis`, `msix`
  - macOS: `dmg`, `zip`
- Local `pm2`, `dotnet` and `node` are visible to the app and `pm2` actions work (see the validation page below).
- Process launch timing on Windows (see spawn chain measurement below).

## Common Commands

```bash
npm ci
npm run dev
npm run build:prod
npm run build:linux
npm run build:linux:deb
npm run build:linux:rpm
npm run build:win
npm run build:win:msix
npm run build:mac:x64
npm run build:mac:arm64
```

## PM2 Validation Page

The renderer home page is now a validation lab for the desktop `pm2` scenario.

- It probes whether local `pm2`, `dotnet`, and `node` are visible from the Electron main process.
- It lets you run `pm2 start/restart/stop/delete/describe/logs/jlist/ping` through the preload bridge.
- It ships a bundled heartbeat worker at `resources/pm2/heartbeat-worker.cjs`, so you can validate `Electron -> local pm2 -> packaged resource` before switching to a real `.NET` server.

Recommended validation flow:

1. Run `npm run dev`.
2. Use `填充心跳脚本示例`, then click `pm2 start`, `jlist`, and `logs`.
3. If the local `pm2` chain works, switch to `填充 .NET Server 示例`, replace the DLL path, and repeat the same actions.

The validation page also supports a dedicated `PM2_HOME` and an automatic no-space alias for paths that contain spaces, which mirrors the behavior the desktop app needs for reliable `pm2` execution.

## Spawn Chain Measurement (Windows)

Measures how long the process launches the HagiCode desktop makes take, in the real chain `Electron -> dotnet -> (git, claude)`, packaged as MSIX and unpackaged.

- `tools/spawn-probe` is a .NET console probe. It starts git and claude with the same `ProcessStartInfo` settings as `HagiCode.Libs`, and with `-p:HagiCodeLibsRoot=<Libs checkout>` it also runs the real `HagiCode.Libs.Git` and `CliProcessManager` code, a file-system probe and a tree walk.
- `src/main/spawn-chain.ts` runs the chain from the Electron main process. If `%USERPROFILE%\win_tester_logs\spawn-chain\request.json` exists (or the file named by `HAGICODE_SPAWN_CHAIN_REQUEST`), the app starts without a window, writes a report and quits. The same run is available over IPC as `runSpawnChain`.
- `scripts/windows-spawn-chain.ps1` builds, registers and runs it; `scripts/show-spawn-chain.ps1` prints a report as a table.

```powershell
powershell -File scripts\windows-spawn-chain.ps1 -Action Build -LibsRoot C:\path\to\Hagicode.Libs
powershell -File scripts\windows-spawn-chain.ps1 -Action Register          # loose registration, needs Developer Mode, no signing
powershell -File scripts\windows-spawn-chain.ps1 -Action Run -Mode msix -Iterations 30 -Repo C:\path\to\a\git\repo
powershell -File scripts\windows-spawn-chain.ps1 -Action Run -Mode unpackaged -Iterations 30 -Repo C:\path\to\a\git\repo
```

`Register` and starting the packaged app need the logged-on desktop session. The loose registration points at the build folder, so it has the package identity but not the `C:\Program Files\WindowsApps` install location of a signed `.msix`.
