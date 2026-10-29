# HagiCode Electron Demo - Agent Configuration

## Root Configuration

Inherits all behavior from `/AGENTS.md` at the monorepo root. Local rules extend or override the root file for this repository.

## Project Context

This repository is a minimal Electron demo that compiles, packages, and runs through a GitHub Actions multi-platform build pipeline. It preserves the core engineering structure of `hagicode-desktop` and serves as a fast lane for validating Electron build, packaging, and release workflows.

## Working Directory

Run commands from `repos/electron_demo/`.

## Key Commands

```bash
pnpm install
pnpm run dev
pnpm run build:prod          # typecheck + build + smoke-test
pnpm run build:tsc:check     # typecheck main, preload, renderer
pnpm run smoke-test
pnpm run build:linux:dir     # Linux package-only self-check used by PR checks
```

CI uses Node.js 24. Platform builds (`build:linux`, `build:win`, `build:mac:*`) package through Electron Forge via `scripts/run-electron-forge.js`.

## Key Paths

- `src/main/`: Electron main process
- `src/preload/`: context bridge
- `src/renderer/`: React + Vite home page (PM2 validation lab UI)
- `src/main/pm2-lab.ts`, `src/main/pm2-home-alias.ts`: PM2 validation lab in the main process (exposed through the preload bridge)
- `src/shared/`: types shared across main, preload, and renderer
- `src/main/spawn-chain.ts`, `tools/spawn-probe/`, `scripts/windows-spawn-chain.ps1`, `scripts/show-spawn-chain.ps1`: Windows spawn-latency measurement for Electron -> dotnet -> git/claude (see README)
- `scripts/`: packaging helpers, artifact preservation, signing verification, smoke tests
- `resources/`: icons, MSIX manifest template and appx logos, PSF `config.template.json`, and the bundled PM2 heartbeat worker (`pm2/heartbeat-worker.cjs`) used by the validation lab
- `.github/workflows/`: `pr-checks.yml`, `build.yml` (+ reusable Windows/Unix builds), and `release-draft-action.yml` (release drafts via `HagiCode-org/hagi-release-drafter`; version comes from commit history)

## Agent Guidelines

- Keep changes aligned with the Electron main/preload/renderer boundary patterns from `hagicode-desktop`.
- Treat this repo as a CI validation lane, not a feature-development target.
- If build or packaging behavior changes, ensure the corresponding GitHub Actions workflows still pass.
- Use `pnpm install` for CI-sensitive installs, `pnpm install` for local iteration.

## References

- `README.md`

## Package management

- The repository uses pnpm, pinned in `package.json` `packageManager`. Run `corepack enable` once, then `pnpm install`. `pnpm-lock.yaml` is the only lockfile; do not commit `package-lock.json`.
- Settings live in `pnpm-workspace.yaml`. `allowBuilds` lists the dependencies whose install scripts may run (reviewed individually, `false` means reviewed and denied); review any new dependency that has an install script and add it there.
- A local registry mirror belongs in `~/.npmrc` only. Never commit a `registry=` line or a mirror URL; `pnpm run check:registry` (also run in CI) fails on any non-`registry.npmjs.org` `tarball` in the lockfile and on mirror hosts in tracked files.
- Undeclared imports fail under pnpm's strict layout: declare the package instead of hoisting it.
