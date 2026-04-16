# Hermes Builder

Hermes Builder is the local control plane for a Hermes runtime.
It combines:

- a React + Vite frontend
- an Express backend that edits Hermes runtime files
- an Electron shell for a Windows desktop experience
- a Windows/WSL bridge so the UI can manage a Hermes runtime hosted inside WSL

The project is designed for a split runtime model:

- source code can live in WSL as the canonical worktree
- Electron packaging and one-click launch can run from a Windows mirror
- the Hermes gateway itself can run inside WSL

## Architecture

### Frontend

- React
- TypeScript
- Vite
- Framer Motion

### Backend

- Node.js
- Express
- Axios
- YAML
- SQLite via `node:sqlite`

### Desktop shell

- Electron
- `electron/main.mjs` starts or reuses the local Builder backend
- the Electron window loads the Builder UI through the local HTTP server

## Runtime model

Hermes Builder is not a static frontend. The backend is the orchestration layer.

It is responsible for:

- resolving the active Hermes home
- supporting Windows paths and WSL UNC paths
- reading and writing `config.yaml`, `SOUL.md`, memories, hooks, skills, sessions, and cron jobs
- probing gateway health
- starting gateway processes inside WSL when needed
- storing Builder-local state under `.hermes-builder/`

Typical ports:

- Hermes Gateway: `8642`
- Hermes Builder backend: `3020`
- Electron desktop wrapper: `3130`
- Electron desktop dev wrapper: `3131`

## Repository layout

- `src/`: frontend application
- `server/index.mjs`: backend API and runtime orchestration
- `electron/`: Electron entrypoints
- `public/`: static assets
- `docs/`: architecture, desktop, and release notes
- `scripts/sync-to-windows.sh`: one-way sync from a WSL canonical repo to a Windows mirror
- `start-*.bat`: Windows one-click launchers

## Quick start

### Web runtime

Standard runtime:

```bat
start-builder.bat
```

Development mode:

```bat
start-builder-dev.bat
```

### Electron desktop

Standard desktop mode:

```bat
start-hermes-desktop.bat
```

Development desktop mode:

```bat
start-hermes-desktop-dev.bat
```

The Electron launchers:

- verify Windows-side Electron dependencies
- ensure the WSL Hermes gateway is reachable
- build the frontend bundle if `dist/` is missing
- launch Electron on a dedicated desktop port

## Local machine overrides

Do not edit the committed launchers for machine-specific paths.

Instead:

1. Copy `hermes-builder.local.cmd.example` to `hermes-builder.local.cmd`
2. Adjust the values for your machine
3. Keep `hermes-builder.local.cmd` untracked

Useful variables:

- `HERMES_WSL_DISTRO`
- `HERMES_CLI_PATH`
- `HERMES_WSL_HOME`
- `HERMES_HOME`
- `HERMES_GATEWAY_PORT`
- `HERMES_DESKTOP_PORT`
- `HERMES_DESKTOP_DEV_PORT`

Recommended split:

- `HERMES_WSL_HOME`: Linux path used by WSL-side gateway commands
- `HERMES_HOME`: Windows/UNC path used by the Builder backend

Example:

```cmd
set "HERMES_WSL_DISTRO=Ubuntu"
set "HERMES_CLI_PATH=/home/your-user/.local/bin/hermes"
set "HERMES_WSL_HOME=/home/your-user/.hermes"
set "HERMES_HOME=\\wsl.localhost\Ubuntu\home\your-user\.hermes"
```

## GitHub strategy

The cleanest publication model is:

1. Keep the canonical git repository in WSL on ext4
2. Commit and push from WSL
3. Sync to a Windows mirror only when you need Windows-native Electron packaging or one-click launch validation

Why this is the safest model:

- Linux and Windows `node_modules` stay separated
- Electron Windows binaries are installed only in the Windows mirror
- Git history stays free of generated artifacts and machine-local state
- WSL remains the source of truth for Hermes runtime integration

Use `scripts/sync-to-windows.sh` from the WSL repo to refresh the Windows mirror.

## Commands

From `package.json`:

- `npm run dev`: backend + Vite middleware on `3020`
- `npm run dev:vite`: legacy Vite-only UI on `3030`
- `npm run build`: TypeScript build + Vite production build
- `npm run lint`: ESLint
- `npm run desktop`: Electron against bundled UI
- `npm run desktop:dev`: Electron in dev mode
- `npm run desktop:pack`: unpacked Electron package in `release/`
- `npm run desktop:build`: Windows NSIS installer in `release/`

## Publishing rules

Before the first GitHub push:

- initialize git in the canonical WSL worktree
- verify `.gitignore` and `.gitattributes`
- do not commit `node_modules/`, `dist/`, `release/`, `.env`, or `hermes-builder.local.cmd`
- keep Windows launchers generic and environment-driven
- keep README examples generic, not tied to one username or one machine path

## Related docs

- `docs/desktop-electron.md`
- `docs/github-readiness-audit.md`
- `docs/plans/2026-04-12-wsl-source-of-truth-migration.md`
