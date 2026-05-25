# HagiCode Electron Demo

A minimal Electron demo that compiles, packages, and runs through a GitHub Actions multi-platform build pipeline.

The goal is not to carry business logic, but to preserve the core engineering structure of `hagicode-desktop` and serve as a fast lane for validating Electron build, packaging, and release workflows.

## Structure

- `src/main` — Electron main process
- `src/preload` — Context bridge
- `src/renderer` — React + Vite home page
- `scripts` — Packaging helpers, MSIX assembly, signing verification, and smoke tests
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
npm run build:win:appx
npm run build:win:msix
npm run build:mac:x64
npm run build:mac:arm64
```

## CI Design

- `pr-checks.yml` — Install, type check, production build, and Linux dir packaging self-check
- `build.yml` — Parallel matrix builds across Linux / Windows / macOS by OS + package format
- Linux targets include `AppImage`, `deb`, `rpm`, `tar.gz`, and `zip`
- Windows targets include `portable`, `nsis`, `appx`, and `msix`
- Tag releases enter the `production` environment, create the GitHub Release up front, and upload assets progressively as each matrix job finishes
- Manual triggers with `production_build=true` also run production builds; they follow production signing checks and only upload workflow artifacts without creating a GitHub Release
- For production builds:
  - The Windows job uses `windows-2025` runners; `.exe` and `.appx` artifacts are strictly signed via Azure Artifact Signing v2, and `appx` / `msix` package manifests read `Publisher` from `WINDOWS_PACKAGE_PUBLISHER` so it can match the signing certificate subject
  - If Azure Artifact Signing fails for `msix`, the signed `win-msix` artifact is skipped and only `win-msix-unsigned` is retained
  - macOS artifacts produce both signed and unsigned packages when signing materials are available; if the production environment lacks signing or notarization credentials, it automatically falls back to unsigned-only builds without blocking the release pipeline
  - Signed Windows / macOS packages are retained alongside their unsigned counterparts; unsigned artifacts are suffixed with `-unsigned` and appear in both workflow artifacts and tag releases

## Release Environment Variables

Production tag releases and manual triggers with `production_build=true` require the following secrets in the repository or `production` environment:

- Windows signing: `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_CODESIGN_ENDPOINT`, `AZURE_CODESIGN_ACCOUNT_NAME`, `AZURE_CODESIGN_CERTIFICATE_PROFILE_NAME`, `WINDOWS_PACKAGE_PUBLISHER`
  - `WINDOWS_PACKAGE_PUBLISHER` must exactly match the Azure Trusted Signing certificate subject because both `appx` and `msix` manifests use it as the `Publisher` value
- macOS signing certificates: `CSC_LINK`, `CSC_KEY_PASSWORD`
  - If missing, production falls back to unsigned-only macOS builds
- macOS notarization:
  - Recommended API key approach: `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`
  - Or Apple ID approach: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`

`appx` and `msix` are included in the Windows release matrix and uploaded as release artifacts. The workflow injects `WINDOWS_PACKAGE_PUBLISHER` into both packaging paths so the manifest `Publisher` matches the signing certificate subject. For `msix`, production signing is still attempted via Azure Artifact Signing v2, but if that step fails only the unsigned `win-msix-unsigned` artifact is kept.

Manual production build example: run `Build Electron Demo` from the Actions page with `production_build` set to `true`. This binds to the `production` environment, executes production-level signing pre-checks, and preserves artifacts in workflow artifacts. Tag-driven releases create the GitHub Release before matrix builds start, then attach each job's assets directly instead of waiting for a final aggregate upload job.
