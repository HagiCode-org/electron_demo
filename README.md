# HagiCode Electron Demo

[![release](https://img.shields.io/github/v/release/HagiCode-org/electron_demo)](https://github.com/HagiCode-org/electron_demo/releases)
[![build](https://img.shields.io/github/actions/workflow/status/HagiCode-org/electron_demo/build.yml?branch=main&label=build)](https://github.com/HagiCode-org/electron_demo/actions/workflows/build.yml)

A minimal Electron demo that compiles, packages, and runs through a GitHub Actions multi-platform build pipeline.

The goal is not to carry business logic, but to preserve the core engineering structure of `hagicode-desktop` and serve as a fast lane for validating Electron build, packaging, and release workflows.

## Structure

- `src/main` — Electron main process
- `src/preload` — Context bridge
- `src/renderer` — React + Vite home page
- `scripts` — Packaging helpers, artifact preservation, signing verification, and smoke tests
- `.github/workflows` — PR checks, entry orchestration workflow, platform reuse workflow, and Release Drafter

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
- It shows PSF-related runtime evidence, including the expected launcher name and whether `config.json` exists next to the packaged executable.

Recommended validation flow:

1. Run `npm run dev`.
2. Use `填充心跳脚本示例`, then click `pm2 start`, `jlist`, and `logs`.
3. If the local `pm2` chain works, switch to `填充 .NET Server 示例`, replace the DLL path, and repeat the same actions.
4. On Windows packaging runs, compare the same flow with and without PSF enabled.

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

`Register` and starting the packaged app need the logged-on desktop session. From SSH use `python3 repos/win_tester/scripts/windows_test_host.py run-interactive "<command>"`. The loose registration points at the build folder, so it has the package identity but not the `C:\Program Files\WindowsApps` install location of a signed `.msix`.

### Finding: windowless MSIX processes are throttled

Measured on Windows 11 26200 (i5-13500H) with the loose registration above. When the packaged app has **no window at all**, its .NET child is put in execution-speed throttling (EcoQoS) about 2.5 s after start. The child's own CPU work then runs 6-7x slower: `File.Exists` x100 goes from 1.3 to 9-10 ms and a `FileInfo` walk over a 1271-file repo from about 26 ms to 166-199 ms. Electron's own Node `fs` calls were not visibly slower in the same runs. Child launches (`git`, `claude`) are not throttled (ratio 1.0-1.16). Unpackaged runs never show it.

- Any window removes it: focused, minimized, `hide()`-n, or another app in front all stay at about 2 ms.
- One `SetProcessInformation(ProcessPowerThrottling, ControlMask=1, StateMask=0)` call in the .NET process restores speed and it stays restored. Opting out of memory/IO priority has no effect.
- The probe options that reproduce this: `-ProbeIdleSeconds N -ProbeOptOutThrottleAt S -ProbeOptOutWhat power|memory|io|background`, `-ProbeCompare` (with `-ProbeOnly compare`), and `-ShowWindow [-WindowMode focused|minimized|hidden] [-StealFocus]`. The probe also writes an `fsSeries` of `File.Exists` x100 every 250 ms to the report.

## CI Design

- `pr-checks.yml` — Install, type check, production build, and Linux dir packaging self-check
- `build.yml` — Parallel matrix builds across Linux / Windows / macOS by OS + package format
- Linux targets include `AppImage`, `deb`, `rpm`, `tar.gz`, and `zip`
- Packaging now uses Electron Forge makers instead of the previous `electron-builder` CLI wrapper
- Windows targets include `portable`, `nsis`, and `msix`
- The MSIX path now matches Microsoft's recommended Forge flow more closely: package the app first, generate an explicit `Package.appxmanifest`, then let the MSIX maker build from that packaged layout
- Tag releases enter the `production` environment and upload assets progressively to an already-created GitHub Release as each matrix job finishes
- Manual triggers with `production_build=true` also run production builds; they follow production signing checks and only upload workflow artifacts without creating a GitHub Release
- For production builds:
  - The Windows job uses `windows-2025` runners; `.exe` and `.msix` artifacts are signed via Azure Artifact Signing v2, and the MSIX manifest reads `Publisher` from `WINDOWS_PACKAGE_PUBLISHER` so it can match the signing certificate subject
  - If Azure Artifact Signing fails for `msix`, the signed `win-msix` artifact is skipped and only `win-msix-unsigned` is retained
  - macOS production builds now import the signing certificate into a temporary keychain, then let Electron Forge packager run `osxSign` and `osxNotarize`
  - Signed macOS and Windows packages are retained alongside their unsigned counterparts; unsigned artifacts are suffixed with `-unsigned` and appear in both workflow artifacts and tag releases

## Release Environment Variables

Production tag releases and manual triggers with `production_build=true` require the following secrets in the repository or `production` environment:

- Windows signing: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_CODESIGN_ENDPOINT`, `AZURE_CODESIGN_ACCOUNT_NAME`, `AZURE_CODESIGN_CERTIFICATE_PROFILE_NAME`, `WINDOWS_PACKAGE_PUBLISHER`
  - `WINDOWS_PACKAGE_PUBLISHER` must exactly match the Azure Trusted Signing certificate subject because the MSIX manifest uses it as the `Publisher` value
- macOS signing certificates: `CSC_LINK`, `CSC_KEY_PASSWORD`
- macOS notarization:
  - Recommended API key approach: `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`
  - Or Apple ID approach: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`

`msix` remains in the Windows release matrix and is uploaded as a release artifact. The workflow injects `WINDOWS_PACKAGE_PUBLISHER` so the manifest `Publisher` matches the signing certificate subject. For `msix`, production signing is still attempted via Azure Artifact Signing v2, but if that step fails only the unsigned `win-msix-unsigned` artifact is kept.

Manual production build example: run `Build Electron Demo` from the Actions page with `production_build` set to `true`. This binds to the `production` environment, executes production-level signing pre-checks, and preserves artifacts in workflow artifacts. Tag-driven releases now assume the GitHub Release already exists and each matrix job uploads its assets directly with `gh release upload --clobber`.

## MSIX Notes

- [resources/msix/Package.appxmanifest.template.xml](/home/newbe36524/repos/hagicode-mono/repos/electron_demo/resources/msix/Package.appxmanifest.template.xml:1) is the source manifest template. Forge prepares the final file at `.cache/msix/Package.appxmanifest` during Windows packaging.
- The demo MSIX manifest now marks the packaged app as an explicit full-trust desktop app by combining `Windows.FullTrustApplication`, `runFullTrust`, `uap10:RuntimeBehavior="packagedClassicApp"`, and `uap10:TrustLevel="mediumIL"`.
- The generated manifest pins `Executable="app\\electron-demo.exe"`, so the MSIX entry point matches `packagerConfig.executableName` instead of Forge's default app folder name.
- Local signing is optional. If `devcert.pfx` exists and `WINDOWS_CERTIFICATE_PASSWORD` is set, Forge signs during MSIX packaging. Otherwise it produces an unsigned MSIX and CI can keep using Azure signing afterward.
- `WINDOWS_KIT_VERSION` is optional now. If you leave it unset, the MSIX tooling falls back to the SDK version implied by the manifest `MinVersion`, which is closer to the Microsoft guidance for avoiding Windows SDK lookup mismatches.
- GitHub Actions now resolves the installed Windows SDK version on the runner before the `msix` job and exports it as `WINDOWS_KIT_VERSION`, so the build does not depend on the manifest `MinVersion` matching the exact SDK version preinstalled on `windows-2025`.

## Optional PSF Injection

The demo now includes an opt-in PSF path for Windows x64 MSIX builds. It is disabled by default so the existing Forge packaging flow stays stable.

Enable it by setting:

```bash
ELECTRON_DEMO_ENABLE_PSF=true
ELECTRON_DEMO_PSF_DIR=/absolute/path/to/psf
```

`ELECTRON_DEMO_PSF_DIR` must contain:

- `PsfLauncher64.exe`
- `PsfRuntime64.dll`
- `ProcessLauncherFixup64.dll`
- `FileRedirectionFixup64.dll`

When enabled:

- `scripts/prepare-msix.js` rewrites the manifest entry executable to `PsfLauncher64.exe`.
- `forge.config.js` keeps using Forge, but injects PSF binaries plus `config.json` into the packaged output during `postPackage`.
- `resources/psf/config.template.json` is rendered so the real app entry remains `app\\electron-demo.exe`, while `ProcessLauncherFixup64.dll` prevents breakaway on spawned child processes.

Example:

```bash
cd repos/electron_demo
ELECTRON_DEMO_ENABLE_PSF=true \
ELECTRON_DEMO_PSF_DIR="C:/tools/psf" \
npm run build:win:msix
```

This gives the demo a concrete place to verify the claim that Electron can still drive local `pm2` correctly inside an MSIX package when PSF is used to keep child-process launches inside the package identity boundary.
