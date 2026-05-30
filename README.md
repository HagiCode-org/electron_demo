# HagiCode Electron Demo

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
- The generated manifest pins `Executable="app\\electron-demo.exe"`, so the MSIX entry point matches `packagerConfig.executableName` instead of Forge's default app folder name.
- Local signing is optional. If `devcert.pfx` exists and `WINDOWS_CERTIFICATE_PASSWORD` is set, Forge signs during MSIX packaging. Otherwise it produces an unsigned MSIX and CI can keep using Azure signing afterward.
- `WINDOWS_KIT_VERSION` is optional now. If you leave it unset, the MSIX tooling falls back to the SDK version implied by the manifest `MinVersion`, which is closer to the Microsoft guidance for avoiding Windows SDK lookup mismatches.
- GitHub Actions now resolves the installed Windows SDK version on the runner before the `msix` job and exports it as `WINDOWS_KIT_VERSION`, so the build does not depend on the manifest `MinVersion` matching the exact SDK version preinstalled on `windows-2025`.
