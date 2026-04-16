# GitHub Readiness Audit

## Scope

This audit covers Hermes Builder as a publishable GitHub repository with a practical Windows one-click launcher, while Hermes itself remains hosted in WSL.

## Validation snapshot

Current status after the repository-hardening pass:

- `npm run build`: passes
- `npm run lint`: passes

The main readiness checks are now green:

- frontend lint is clean
- production build succeeds
- launchers use ignored local machine overrides instead of committed personal paths

## Current architecture assessment

### What is already solid

- The backend is clearly centralized in `server/index.mjs`
- Electron is thin and correctly delegates orchestration to the backend
- The desktop entrypoint already auto-starts the Builder backend when missing
- WSL path handling already exists in the backend through UNC parsing and `wsl.exe`
- The product boundary is clear: Builder is a control plane, not the Hermes runtime itself

### What was blocking a clean public repo

- machine-specific paths and usernames leaked into committed scripts and docs
- the WSL gateway launcher was hardcoded to one distro and one Hermes binary path
- there was no ignored local config contract for Windows launchers
- `.gitignore` did not cover `release/`, `.env`, local launcher config, or several transient files
- there was no line-ending policy for a Windows + WSL codebase
- there was no repeatable source-sync script for the WSL -> Windows mirror workflow
- the project is not yet initialized as a git repository

## Best repository model

The recommended model is:

1. Canonical source and git history live in WSL
2. Commits and pushes happen from WSL
3. Windows is a build-and-launch mirror for Electron only

This model is technically superior here because:

- Windows Electron binaries and Linux runtime dependencies must not share the same `node_modules`
- WSL is the environment closest to the Hermes runtime
- Git behavior is more predictable on the canonical ext4 worktree
- Windows remains available for packaging, installer tests, and one-click desktop UX

## Best one-click launch model

The recommended one-click entrypoint remains `start-hermes-desktop.bat`.

The correct design is:

1. committed launcher stays generic
2. machine-specific values live in `hermes-builder.local.cmd`
3. launcher starts the WSL gateway only if health checks fail
4. launcher launches Electron only after the gateway is reachable

This keeps the UX simple for the operator while keeping the repository clean for GitHub.

## Commit strategy

Recommended flow:

1. open the canonical repo in WSL
2. edit and test there
3. commit from WSL
4. run `scripts/sync-to-windows.sh <windows-mirror>`
5. from Windows, run `npm install` if needed and validate `start-hermes-desktop.bat`
6. push from WSL

Do not use the Windows mirror as a second edit-first worktree.

## Required pre-publish checklist

- `git init` in the WSL canonical tree
- add GitHub remote
- verify `.gitignore`
- verify `.gitattributes`
- keep `hermes-builder.local.cmd` untracked
- keep `.env` untracked
- do not commit `dist/`, `release/`, or `node_modules/`
- run `npm run build`
- validate desktop launch from the Windows mirror

## Residual technical risks

- The backend remains large and monolithic in `server/index.mjs`, which increases maintenance risk
- Desktop launch still depends on `wsl.exe` and a working Hermes CLI inside the target distro
- Gateway health is still assumed on a fixed default port unless overridden
- The repo still needs an actual git initialization and first commit outside this audit

## Recommended next refactors after publication

- split `server/index.mjs` into runtime, files, sessions, and gateway modules
- add automated smoke tests for the health endpoints and launch preconditions
- add CI for `npm run build` and `npm run lint`
- optionally move more launcher logic from `.bat` into testable Node scripts
