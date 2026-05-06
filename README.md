# Hermes Desktop

A local-first desktop environment for running and controlling Hermes AI agents on Windows.

<p align="center">
  <img src="public/Hermes_anime.jpg" width="280" alt="Hermes Desktop mascot"/>
</p>

[![CI](https://github.com/sunuai221-oss/Hermes-Desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/sunuai221-oss/Hermes-Desktop/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## What Is Hermes Desktop?

- A local-first control surface for Hermes on Windows.
- An Electron shell backed by a local Express service and a React UI served over `localhost`.
- A one-click entrypoint for gateway status, sessions, memory, configuration, hooks, skills, automations, and voice workflows.
- A desktop workflow that keeps the Hermes runtime in WSL while keeping Windows packaging and launchers local.
- A modular backend split into routes and services for gateway orchestration, profile resolution, runtime files, sessions, and voice.
- A public product named `Hermes Desktop`, with a small number of legacy `builder` names preserved only for compatibility.

## Why This Exists

Hermes Desktop gives Hermes a repeatable local operator workflow on Windows. Instead of relying on ad hoc browser tabs, manual port handling, and one-off WSL commands, it provides a stable desktop entrypoint that stays close to the local runtime.

## Screenshots

### Chat interface

Main interaction view for working with Hermes agents in real time.

![Hermes Desktop chat interface](docs/screenshots/chat-20260419.png)

### Delegation system

Interface for orchestrating multi-agent workflows and task delegation.

![Hermes Desktop delegation system](docs/screenshots/delegation-20260419.png)

## Platform Support

| Platform | Status | Notes |
| --- | --- | --- |
| Windows with WSL | Supported | Primary target and recommended setup. |
| Windows without WSL | Not supported for normal use | Hermes is expected to run inside WSL. |
| Native Linux desktop | Not packaged | Some code is portable, but launchers and packaging are Windows-first today. |

## Prerequisites

Required:

- Windows with WSL enabled and a working Linux distribution.
- A Hermes runtime and Hermes CLI available inside that WSL distribution.
- Node.js 22 or newer on Windows.
- `npm`, which ships with Node.js.

Optional:

- A canonical WSL worktree if you prefer to keep git history and day-to-day development on ext4.
- A local NeuTTS HTTP server, such as `http://127.0.0.1:8020`, for speech synthesis.
- `ffmpeg` if your TTS service returns non-WAV audio or if you configure the optional Kokoro provider with non-`wav` output.

If you develop from a canonical WSL worktree, use Node.js 22 or newer there as well.

## Quick Start (recommended)

For a fresh checkout on Windows:

```powershell
npm run setup
```

The committed defaults expect:

- WSL distro: `Ubuntu`
- Hermes home inside WSL: `$HOME/.hermes`
- Hermes CLI discoverable as `hermes` or installed under `$HOME/.local/bin`
- Desktop backend port: `3020`
- Gateway port: `8642`

If your machine uses different values, copy the local override template and keep the copy untracked:

```powershell
Copy-Item hermes-desktop.local.cmd.example hermes-desktop.local.cmd
```

Then update only the variables your machine needs.

Run the desktop application:

```bat
start-hermes-desktop.bat
```

For development mode:

```bat
start-hermes-desktop-dev.bat
```

`start-hermes-desktop.bat` is the default entrypoint. It checks Windows dependencies, verifies the Hermes gateway in WSL using `/health`, `/v1/health`, or a TCP probe, builds the UI bundle if needed, and launches Hermes Desktop in Electron.

To validate a local checkout before launching the UI, run:

```powershell
npm run desktop:smoke
```

## Launcher Modes

Use the Electron launcher.

| Workflow | Script | When to use it |
| --- | --- | --- |
| Recommended desktop launch | `start-hermes-desktop.bat` | Default one-click entrypoint for normal use. |
| Desktop development | `start-hermes-desktop-dev.bat` | Runs Electron in development mode. |

## Runtime Model

At a high level, Hermes Desktop follows this flow:

1. a Windows launcher loads optional local overrides and checks local dependencies
2. the launcher verifies that the Hermes gateway in WSL is reachable and starts it if needed, reusing an existing gateway process when possible
3. Electron starts or reuses the local backend on Windows
4. the backend serves the UI over `localhost` and manages Hermes runtime state and files
5. voice requests use the backend pipeline for STT and NeuTTS server playback

## Technical Architecture

Hermes Desktop is a three-process local stack:

| Layer | Runs in | Default endpoint | Responsibility |
| --- | --- | --- | --- |
| Electron shell | Windows | loads `http://127.0.0.1:3020` | Owns the desktop window, theme background, external-link handling, and startup orchestration. |
| Desktop backend | Windows Node.js | `http://127.0.0.1:3020` | Serves the React UI, exposes `/api/*`, resolves profiles and files, and proxies/coordinates gateway calls. |
| Hermes gateway | WSL | `http://127.0.0.1:8642` | Runs the Hermes runtime API used for chat, model/provider calls, diagnostics, and agent operations. |

Startup details:

1. `start-hermes-desktop.bat` loads `hermes-desktop.local.cmd` or the legacy `hermes-builder.local.cmd` if present.
2. It verifies Windows Electron dependencies and `server/node_modules`; missing dependencies are installed with `npm install` and `npm run install:server`.
3. It checks the gateway via `/health`, `/v1/health`, and a TCP probe. If the gateway is offline, it starts `run-gateway-wsl.cmd`.
4. It builds `dist/` with `npm run build` when the production frontend bundle is missing.
5. Electron starts. If `/api/desktop/health` is already healthy on `3020`, it reuses that backend; otherwise it spawns `server/index.mjs` with the current Node executable.
6. Electron asks the backend to start the gateway through `POST /api/gateway/start` if the gateway is still offline.
7. Electron creates a `BrowserWindow` and loads the backend URL. The window uses `electron/preload.mjs`, `contextIsolation: true`, and `nodeIntegration: false`.

Frontend serving:

- Production mode serves the built React bundle from `dist/`.
- Dev mode uses `start-hermes-desktop-dev.bat`, sets `HERMES_ELECTRON_DEV=1`, and lets the backend mount Vite as middleware on the same backend origin.
- Standalone Vite development is available through `npm run dev:vite` on port `3030`, but the normal Electron path uses port `3020`.

Profile and filesystem resolution:

- The backend resolves the base Hermes home from `HERMES_HOME`, `HERMES_WSL_HOME`, the parent `.hermes` folder, the Windows user `.hermes`, or an auto-detected WSL `$HOME/.hermes`.
- The default WSL distro is `Ubuntu`; override it with `HERMES_WSL_DISTRO`.
- Gateway launch uses `HERMES_CLI_PATH` when set, otherwise `hermes` from `PATH`, with `$HOME/.local/bin` prepended inside WSL.
- Profile-specific state is isolated through the profile resolver, while legacy `.hermes-builder` state paths remain only for compatibility.

Main backend surfaces:

- `/api/desktop/health`: backend health and frontend bundle readiness.
- `/api/gateway/*`: gateway health, process control, diagnostics, chat, and streaming chat proxy.
- `/api/sessions/*`: local session CRUD, transcripts, continuation, resume, export, and stats.
- `/api/skills`, `/api/skills/content`, `/api/skills/enabled`: local/external skill listing, editing, and enable/disable state.
- `/api/plugins` and `/api/hooks`: extension and hook discovery.
- `/api/config`, `/api/profiles/*`, `/api/agents/*`, `/api/memory/*`, `/api/context-files/*`, `/api/cronjobs/*`: runtime configuration, profile management, agent presets, memory, context references, and automations.

## Does Hermes Desktop depend on a web app?

No.

Hermes Desktop runs entirely locally. The Electron app starts (or reuses) a local backend, which serves the UI over HTTP.

There is no hosted frontend or cloud service required for the desktop UI. Normal use still requires the local WSL Hermes runtime described in the prerequisites.

Some internal paths and variables still use legacy `builder` naming for compatibility. These are internal implementation details only.

## Current Backend Shape

The backend is no longer a single large entrypoint. `server/index.mjs` now wires together smaller route and service modules:

- `server/routes/`: API route registration
- `server/services/gateway-manager.mjs`: WSL gateway process lifecycle
- `server/services/gateway-proxy.mjs`: gateway health, chat, provider payloads, and fallback calls
- `server/services/path-resolver.mjs`: Windows, WSL, UNC, and gateway target path helpers
- `server/services/profile-resolver.mjs`: Hermes home and profile path resolution
- `server/services/voice.mjs`: voice request pipeline, STT orchestration, NeuTTS server requests, and TTS provider dispatch
- `server/services/kokoro-tts.mjs`: optional Kokoro provider helpers, speech shaping, FR/EN routing, and WAV concatenation

## Planned Improvements

The current roadmap focuses on a smaller number of remaining engineering upgrades:

- add broader automated smoke tests around desktop launch and gateway health
- harden Windows packaging and release validation over time
- continue reducing legacy `builder` naming where compatibility allows

See `docs/product-roadmap.md` for the broader direction.

## Repository Layout

- `src/`: React frontend
- `server/`: local Express backend, route modules, runtime services, and tests
- `electron/`: Electron entrypoints
- `public/`: runtime static assets bundled with the UI
- `docs/`: product, workflow, and maintenance documentation
- `docs/screenshots/`: README screenshots
- `scripts/sync-to-windows.sh`: WSL-to-Windows mirror sync helper
- `start-*.bat`: Windows launchers
- `run-gateway-wsl.cmd`: WSL gateway launcher helper

## Configuration and Local Overrides

Do not edit committed launchers for machine-specific paths. Use a local override file instead.

Preferred setup:

1. try the committed launcher defaults first
2. if your WSL setup differs, copy `hermes-desktop.local.cmd.example` to `hermes-desktop.local.cmd`
3. set only the values your machine needs
4. keep `hermes-desktop.local.cmd` untracked

Most useful variables:

- `HERMES_WSL_DISTRO`
- `HERMES_CLI_PATH`
- `HERMES_WSL_HOME`
- `HERMES_HOME`
- `HERMES_GATEWAY_PORT`
- `HERMES_DESKTOP_PORT`
- `HERMES_DESKTOP_DEV_PORT`

Compatibility note:

- `hermes-builder.local.cmd` remains supported as a legacy override filename
- some internal environment variables still use `HERMES_BUILDER_*`
- the local compatibility state directory remains `.hermes-builder/`

These names are compatibility bridges, not public branding.

## Development Workflow

The recommended working model is:

1. keep the canonical git repository in WSL on ext4
2. edit and commit there
3. sync to a Windows mirror when you need Electron packaging or launcher validation

Why this model is safer:

- Linux and Windows `node_modules` remain separate
- Electron Windows binaries stay on the Windows mirror
- the runtime environment stays close to the Hermes source of truth

Useful commands:

```powershell
npm run setup
npm run install:server
npm run lint
npm run build
npm run check
```

## Voice And TTS

Hermes Desktop uses the backend voice pipeline for microphone input and message speech playback.

- STT still runs through `server/voice_tools.py` and local Python dependencies.
- TTS is handled by an already-running NeuTTS HTTP server.
- The Config page exposes TTS provider selection, NeuTTS server URL settings, and the optional Kokoro provider controls when that provider is selected.
- Chat messages can be copied or synthesized directly from the message toolbar.

Default NeuTTS settings expect a local service at `http://127.0.0.1:8020` with the `POST /tts` endpoint. Hermes Desktop splits longer text into speakable segments, requests audio from NeuTTS, and joins the generated WAV segments for playback. Kokoro-compatible TTS remains available as an optional provider for setups that still use `http://127.0.0.1:8880` and `/v1/audio/speech`.

## Known Limitations

- Windows-first. Linux and macOS are not fully supported yet.
- Requires a working WSL setup and a Hermes runtime inside the configured distribution.
- No published installer release yet. The current workflow still relies on manual launch scripts.

## Troubleshooting

Common issues on a fresh setup:

- `electron.exe` is missing or the launcher reports a Linux Electron binary: run `npm run setup` in the Windows working tree.
- The backend fails with missing Node modules: run `npm run install:server` or `npm run setup`.
- The gateway does not start from Windows: verify `HERMES_WSL_DISTRO`, `HERMES_CLI_PATH`, and that the Hermes CLI works inside WSL.
- NeuTTS speech synthesis fails: verify that the NeuTTS server is running, that `tts.provider` is set to `neutts-server`, and that `tts.neutts_server.base_url` points to it. The default URL is `http://127.0.0.1:8020`.
- You see `builder` names in logs, config, or health routes: that is expected compatibility naming, not a second product.

For more detail, see `docs/troubleshooting.md`.

## Documentation

- `docs/desktop-electron.md`
- `docs/troubleshooting.md`
- `docs/repository-notes.md`
- `docs/product-roadmap.md`
- `docs/wsl-windows-workflow.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `CODE_OF_CONDUCT.md`

## License

MIT. See `LICENSE`.
