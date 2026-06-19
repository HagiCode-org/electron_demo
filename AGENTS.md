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
npm run build:prod
npm run smoke-test
```

## Key Paths

- `src/main/`: Electron main process
- `src/preload/`: context bridge
- `src/renderer/`: React + Vite home page
- `scripts/`: packaging helpers, artifact preservation, signing verification, smoke tests
- `.github/workflows/`: CI/CD pipelines including Release Drafter

## Agent Guidelines

- Keep changes aligned with the Electron main/preload/renderer boundary patterns from `hagicode-desktop`.
- Treat this repo as a CI validation lane, not a feature-development target.
- If build or packaging behavior changes, ensure the corresponding GitHub Actions workflows still pass.
- Use `npm ci` for CI-sensitive installs, `npm install` for local iteration.

## References

- `README.md`
