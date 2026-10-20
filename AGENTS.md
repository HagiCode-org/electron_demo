# HagiCode Electron Demo - Agent Configuration

## Root Configuration

Inherits all behavior from `/AGENTS.md` at the monorepo root. Local rules extend or override the root file for this repository.

## Project Context

This repository is a minimal Electron demo that compiles, packages, and runs through a GitHub Actions multi-platform build pipeline. It preserves the core engineering structure of `hagicode-desktop` and serves as a fast lane for validating Electron build, packaging, and release workflows.

## Working Directory

Run commands from `repos/electron_demo/`.

## Key Commands

```bash
npm ci
npm run dev
npm run build:prod          # typecheck + build + smoke-test
npm run build:tsc:check     # typecheck main, preload, renderer
npm run smoke-test
npm run build:linux:dir     # Linux package-only self-check used by PR checks
```

CI uses Node.js 24. Platform builds (`build:linux`, `build:win`, `build:mac:*`) package through Electron Forge via `scripts/run-electron-forge.js`.

## Key Paths

- `src/main/`: Electron main process
- `src/preload/`: context bridge
- `src/renderer/`: React + Vite home page (PM2 validation lab UI)
- `src/main/pm2-lab.ts`, `src/main/pm2-home-alias.ts`: PM2 validation lab in the main process (exposed through the preload bridge)
- `src/shared/`: types shared across main, preload, and renderer
- `scripts/`: packaging helpers, artifact preservation, signing verification, smoke tests
- `resources/`: icons, MSIX manifest template and appx logos, PSF `config.template.json`, and the bundled PM2 heartbeat worker (`pm2/heartbeat-worker.cjs`) used by the validation lab
- `.github/workflows/`: `pr-checks.yml`, `build.yml` (+ reusable Windows/Unix builds), and `release-draft-action.yml` (release drafts via `HagiCode-org/hagi-release-drafter`; version comes from commit history)

## Agent Guidelines

- Keep changes aligned with the Electron main/preload/renderer boundary patterns from `hagicode-desktop`.
- Treat this repo as a CI validation lane, not a feature-development target.
- If build or packaging behavior changes, ensure the corresponding GitHub Actions workflows still pass.
- Use `npm ci` for CI-sensitive installs, `npm install` for local iteration.

## References

- `README.md`
