---
public: true
multilingual: false
style: product
---

# README requirements

## Product focus

- Introduce HagiCode Electron Demo as a minimal Electron app that lets the HagiCode desktop team check, on every platform, that an Electron app builds, packages and runs the same way `hagicode-desktop` does. It carries no business logic and is internal tooling rather than an end-user product; say so plainly.
- Describe what its direct users get: installable packages for Linux, Windows and macOS (for example AppImage, deb, rpm, nsis, portable, MSIX and macOS builds), a validation page in the app that probes whether local `pm2`, `dotnet` and `node` are visible and can run `pm2` actions against a bundled heartbeat worker, and a Windows spawn-chain measurement for process launch timing.
- Address the maintainers and testers of the HagiCode desktop app who need a small, fast app to validate packaging and runtime behavior.
- Lead with what the demo lets them verify before any build or workflow detail.

## Required content

- Open with a short introduction of the demo and its purpose, plus the badges the current README carries.
- Keep what the validation page does and the recommended steps to use it, and the common run and build commands, which must match `package.json` and `scripts/`.
- Keep a short description of the Windows spawn-chain measurement at usage level: what it measures and how to run it.
- List only the package formats and platforms the build configuration actually produces.

## Exclusions

- Exclude signing certificates, passwords, release secret values, tokens, internal hosts, machine-specific paths and private links.
- Do not list features the demo does not show.
- Keep repository maintenance instructions out of the README: repository structure, CI design, release environment variables, signing setup, MSIX manifest and PSF injection internals, and contribution workflow.
