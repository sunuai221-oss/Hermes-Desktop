# Hermes Desktop (Electron)

## Purpose

The Electron layer provides a Windows desktop shell around the local Hermes Desktop backend.
It does not replace the backend. It boots or reuses the local server, then loads the UI through HTTP.

Core files:

- `electron/main.mjs`
- `electron/preload.mjs`
- `electron/launch-dev.mjs`
- `start-hermes-desktop.bat`
- `start-hermes-desktop-dev.bat`
- `run-gateway-wsl.cmd`

## Startup flow

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

## WSL configuration

The launchers are intentionally generic. Machine-specific values belong in an ignored local file:

- copy `hermes-desktop.local.cmd.example`
- rename it to `hermes-desktop.local.cmd`
- set only the variables you need

Compatibility note:

- older setups can keep using `hermes-builder.local.cmd`

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
- `npm run desktop:pack`
- `npm run desktop:build`

Notes:

- `asar` is disabled on purpose in this phase to keep backend startup simple
- Windows packaging should be validated from the Windows mirror, not from the WSL canonical repo
- Electron dependencies must be installed on Windows because `electron.exe` is platform-specific

## Recommended repo model

For GitHub publication and ongoing maintenance:

1. keep the git repository in WSL
2. sync source into a Windows mirror with `scripts/sync-to-windows.sh`
3. run `npm install` in Windows only for Electron packaging and launch validation
4. keep local override files untracked
