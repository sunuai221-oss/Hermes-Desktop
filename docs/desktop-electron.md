# Hermes Desktop Runtime

## Purpose

Hermes Desktop uses Electron as a Windows desktop shell around the local backend.
Electron does not replace the backend. It starts or reuses the local server, then loads the UI over HTTP on `localhost`.

Core files:

- `electron/main.mjs`
- `electron/preload.mjs`
- `electron/launch-dev.mjs`
- `start-hermes-desktop.bat`
- `start-hermes-desktop-dev.bat`
- `start-builder.bat`
- `start-builder-dev.bat`
- `run-gateway-wsl.cmd`

## Launcher guide

Use these launchers according to the workflow you want:

| Script | When to use it | Notes |
| --- | --- | --- |
| `start-hermes-desktop.bat` | Normal desktop use | Recommended default entrypoint. |
| `start-hermes-desktop-dev.bat` | Electron development | Starts Electron in development mode. |
| `start-builder.bat` | Optional browser mode | Runs the same local backend and opens the UI in a browser. |
| `start-builder-dev.bat` | Browser development | Uses the browser workflow with dev middleware. |

The browser launchers keep older `builder` naming for compatibility and continuity. They are optional and do not represent a separate product or a separate hosted web app.

## Desktop startup flow

### Standard desktop

`start-hermes-desktop.bat` does the following:

1. loads optional local overrides from `hermes-desktop.local.cmd`
2. verifies the Windows Electron binary exists
3. starts the Hermes gateway in WSL if it is not already healthy
4. builds `dist/` if the frontend bundle is missing
5. launches Electron on port `3130` by default

### Desktop dev

`start-hermes-desktop-dev.bat`:

1. loads optional local overrides
2. verifies the Windows Electron binary exists
3. ensures the Hermes gateway is reachable
4. launches Electron in dev mode on port `3131` by default

## Fresh clone setup

For a new checkout on Windows, run:

```powershell
npm run setup
```

This installs both:

- the root dependencies for the frontend and Electron shell
- the backend dependencies under `server/`

For most users, the next step is to copy `hermes-desktop.local.cmd.example` to `hermes-desktop.local.cmd`, adjust it only if needed, and launch `start-hermes-desktop.bat`.

## WSL configuration

The launchers are intentionally generic. Machine-specific values belong in an ignored local file:

- copy `hermes-desktop.local.cmd.example`
- rename it to `hermes-desktop.local.cmd`
- set only the variables you need

Compatibility note:

- older setups can keep using `hermes-builder.local.cmd`
- `hermes-builder.local.cmd.example` remains available for older local setups
- some internal environment variables still use `HERMES_BUILDER_*`
- the compatibility state folder remains `.hermes-builder/`

Most useful variables:

- `HERMES_WSL_DISTRO`
- `HERMES_CLI_PATH`
- `HERMES_WSL_HOME`
- `HERMES_HOME`
- `HERMES_GATEWAY_PORT`

The gateway launcher resolves the Hermes binary in this order:

1. `HERMES_CLI_PATH`
2. `command -v hermes`
3. `$HOME/.local/bin/hermes`

## Packaging

Available commands:

- `npm run desktop`
- `npm run desktop:dev`
- `npm run desktop:smoke`
- `npm run desktop:pack`
- `npm run desktop:build`

Packaging prerequisites:

- run from a Windows shell (not inside WSL)
- install dependencies with `npm run setup` (or `npm install` + `npm run install:server`)
- keep `start-hermes-desktop.bat` as the canonical local/dev launcher

Installer outputs:

- unpacked app: `release/win-unpacked/` (`npm run desktop:pack`)
- NSIS installer: `release/Hermes-Desktop-<version>-<arch>.exe` (`npm run desktop:build`)

Smoke validation:

```powershell
npm run desktop:smoke
```

This checks:

- Windows Electron binary presence (and detects Linux/WSL Electron mismatch)
- configured WSL distro availability
- gateway health on `http://127.0.0.1:8642`
- backend health on `http://127.0.0.1:3130/api/desktop/health`

Notes:

- `asar` is currently disabled while packaged runtime path assumptions are still being verified
- Windows packaging should be validated from the Windows mirror, not from the WSL canonical repo
- Electron dependencies must be installed on Windows because `electron.exe` is platform-specific
- the browser launchers are helpful for UI debugging, but Electron remains the primary user-facing mode

## Recommended repo model

For GitHub publication and ongoing maintenance:

1. keep the git repository in WSL
2. sync source into a Windows mirror with `scripts/sync-to-windows.sh`
3. run `npm run setup` in Windows for a fresh clone, or `npm install` when only the Windows Electron binary needs to be refreshed
4. keep local override files untracked

## Related docs

- `README.md`
- `docs/troubleshooting.md`
- `docs/wsl-windows-workflow.md`
