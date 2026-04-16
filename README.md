# Hermes Desktop

Hermes Desktop is a Windows-first Electron application for operating a Hermes runtime hosted in WSL.

It ships as one local product:

- a React + Vite interface
- an Express backend that reads and edits Hermes runtime files
- an Electron shell for the Windows desktop experience
- a Windows/WSL bridge that starts or reconnects to the Hermes gateway

## Does Electron depend on a separate web app?

No.

Electron does not require a hosted web app or a separate deployed frontend. It starts or reuses the local backend, and that backend serves the same UI locally over HTTP.

Some internal routes, environment variables, and state folders still use historical `builder` names for compatibility, but those are implementation details. The public product name is `Hermes Desktop`.

## Platform support

- Supported today: Windows with WSL
- Not packaged today: native Linux desktop builds

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
- `electron/main.mjs` starts or reuses the local backend
- the Electron window loads the local UI through the backend HTTP server

## Runtime model

Hermes Desktop is not just a static frontend. The local backend is the orchestration layer.

It is responsible for:

- resolving the active Hermes home
- supporting Windows paths and WSL UNC paths
- reading and writing `config.yaml`, `SOUL.md`, memories, hooks, skills, sessions, and cron jobs
- probing gateway health
- starting gateway processes inside WSL when needed
- storing local desktop state under `.hermes-builder/` for backward compatibility

Typical ports:

- Hermes Gateway: `8642`
- Local backend: `3020`
- Electron desktop wrapper: `3130`
- Electron desktop dev wrapper: `3131`

## Repository layout

- `src/`: frontend application
- `server/index.mjs`: backend API and runtime orchestration
- `electron/`: Electron entrypoints
- `public/`: static assets
- `docs/`: operator and repository documentation
- `scripts/sync-to-windows.sh`: one-way sync from a WSL canonical repo to a Windows mirror
- `start-*.bat`: Windows launchers

## Quick start

### Desktop mode

Standard desktop mode:

```bat
start-hermes-desktop.bat
```

Development desktop mode:

```bat
start-hermes-desktop-dev.bat
```

The desktop launchers:

- verify Windows-side Electron dependencies
- ensure the Hermes gateway is reachable
- build the frontend bundle if `dist/` is missing
- launch Electron on the configured local backend port

### Optional browser mode

If you want to run the same local UI in a browser without Electron:

```bat
start-builder.bat
```

Development browser mode:

```bat
start-builder-dev.bat
```

These browser launchers are optional. Electron does not depend on them.

## Local machine overrides

Do not edit committed launchers for machine-specific paths.

Preferred setup:

1. Copy `hermes-desktop.local.cmd.example` to `hermes-desktop.local.cmd`
2. Adjust the values for your machine
3. Keep `hermes-desktop.local.cmd` untracked

Compatibility note:

- the launchers also fall back to `hermes-builder.local.cmd` for older setups

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
- `HERMES_HOME`: Windows or UNC path used by the local backend

Example:

```cmd
set "HERMES_WSL_DISTRO=Ubuntu"
set "HERMES_CLI_PATH=/home/your-user/.local/bin/hermes"
set "HERMES_WSL_HOME=/home/your-user/.hermes"
set "HERMES_HOME=\\wsl.localhost\Ubuntu\home\your-user\.hermes"
```

## Development workflow

The cleanest long-term model is:

1. keep the canonical git repository in WSL on ext4
2. commit and push from WSL
3. sync to a Windows mirror only when you need Electron packaging or one-click launch validation

Why this works best:

- Linux and Windows `node_modules` stay separated
- Electron Windows binaries are installed only in the Windows mirror
- Git history stays free of generated artifacts and machine-local state
- WSL remains the source of truth for Hermes runtime integration

Use `scripts/sync-to-windows.sh` from the WSL repo to refresh the Windows mirror.

## Commands

From `package.json`:

- `npm run dev`: backend + Vite middleware on `3020`
- `npm run dev:vite`: browser-only UI on `3030`
- `npm run build`: TypeScript build + Vite production build
- `npm run lint`: ESLint
- `npm run desktop`: Electron against bundled UI
- `npm run desktop:dev`: Electron in dev mode
- `npm run desktop:pack`: unpacked Electron package in `release/`
- `npm run desktop:build`: Windows NSIS installer in `release/`

## Repository hygiene

- do not commit `node_modules/`, `dist/`, `release/`, `.env`, `hermes-desktop.local.cmd`, or `hermes-builder.local.cmd`
- keep launchers generic and environment-driven
- keep docs and examples free of personal usernames or machine paths

## License

No open-source license has been added yet.

## Related docs

- `docs/desktop-electron.md`
- `docs/repository-notes.md`
- `docs/product-roadmap.md`
- `docs/wsl-windows-workflow.md`
