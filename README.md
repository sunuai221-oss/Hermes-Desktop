# Hermes Desktop

A local-first desktop environment for running and controlling Hermes AI agents on Windows.

[![CI](https://github.com/sunuai221-oss/Hermes-Desktop/actions/workflows/ci.yml/badge.svg)](https://github.com/sunuai221-oss/Hermes-Desktop/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

## What Is Hermes Desktop?

- A local-first control surface for Hermes on Windows.
- An Electron shell backed by a local Express service and a React UI served over `localhost`.
- A one-click entrypoint for gateway status, sessions, memory, configuration, hooks, skills, automations, and voice workflows.
- A desktop workflow that keeps the Hermes runtime in WSL while keeping Windows packaging and launchers local.
- A modular backend split into routes and services for gateway orchestration, profile resolution, runtime files, sessions, and voice.
- A companion layer for Pawrtal pets, Live2D avatars, and voice-driven avatar animation.
- A public product named `Hermes Desktop`, with a small number of legacy `builder` names preserved only for compatibility.

## Why This Exists

Hermes Desktop gives Hermes a repeatable local operator workflow on Windows. Instead of relying on ad hoc browser tabs, manual port handling, and one-off WSL commands, it provides a stable desktop entrypoint that stays close to the local runtime.

## Latest Cockpit Refresh

The current GitHub version includes the new local cockpit surfaces that were previously only in the working tree:

- **Templates**: a searchable agent template library with bundled offline templates, source/category filters, preferred skill controls, import from local path, URL, or Git source, and a default agency import flow.
- **Workspaces**: a visual multi-agent canvas where templates can be dragged into a workspace, selected, configured, connected with relationships, and executed with shared context and common rules.
- **Workspace relations**: workspace nodes are no longer isolated cards only. The editor stores and renders directed relations between agents so a workspace can express an actual flow, handoff, or review chain.
- **Workspace node table**: Workspaces now include a compact node table for scanning roles, models, skills, toolsets, and relation counts without opening every card on the canvas.
- **Workspace auto-config preview**: a pipeline brief can generate a preview of suggested workspace defaults, node roles, skill/toolset assignments, and relations before the patch is applied.
- **Generated workspace interface**: each workspace can open a generated chat interface that uses the configured agents, roles, context, rules, and relations as the active conversation frame.
- **Chat import workspace**: the Chat page can import a workspace directly, so an existing workspace plan can seed a normal chat session without rebuilding the prompt manually.
- **Companions**: a new Companions page manages Pawrtal companions and the detached Live2D avatar from one place.
- **Live2D avatars**: bundled local Shizuku and Mashiro models can run offline, with support for user-imported Live2D models under the Hermes home.
- **Voice-linked avatar lipsync**: message playback now emits local voice events so the detached Live2D avatar can animate its mouth while NeuTTS audio is playing.
- **NeuTTS-only TTS path**: Kokoro-specific server code was removed. The voice pipeline now targets an already-running NeuTTS HTTP server and keeps long-message WAV joining in the desktop backend.
- **Pawrtal integration**: Hermes Desktop can list, launch, switch, hide, reset, and auto-start Pawrtal companions through the local backend.
- **Cleaner navigation**: the sidebar now uses the Hermes wordmark only. The old static anime sidebar image was removed; character visuals live in the dedicated Companions/Live2D surfaces instead.
- **Identity and memory cockpit**: the former Soul surface is now organized into Identity panels for memory, conversation search, and profile identity work.
- **Runtime diagnostics**: Config now exposes gateway health, process status, log viewing, doctor/dump/backup actions, model context window settings, delegation defaults, Pawrtal options, and NeuTTS server configuration.
- **Kanban and Docs pages**: local project tracking and documentation views are now part of the desktop navigation.
- **Backend split**: Agent Studio, profiles, identity, kanban, context files, media, gateway, and runtime features are exposed through smaller backend routes and services instead of one large entrypoint.

For a guided walkthrough of the Templates and Workspaces flow, see [`docs/templates-workspaces-tutorial.md`](docs/templates-workspaces-tutorial.md).

## Screenshots

### Chat interface

Main interaction view for working with Hermes agents in real time.

![Hermes Desktop chat interface](docs/screenshots/chat-20260419.png)

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
- The `pawrtal` CLI installed inside the same WSL distribution if you want desktop companions.
- User Live2D models in `<Hermes home>/live2d-models/<model-name>/` if you want to add models beyond the bundled assets.
- `ffmpeg` if your TTS service returns non-WAV audio.

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
6. companion requests bridge from the Windows backend into WSL Pawrtal state and commands when configured

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
- `/api/agent-studio/*`: template library, bundled agency import, workspace CRUD, workspace execution, and generated workspace chat.
- `/api/pawrtal/*`: companion discovery, status, use, spawn, vanish, switch, reset, and autostart commands through the WSL `pawrtal` CLI.
- `/api/live2d/*`: discovery and serving for user-imported Live2D models under the Hermes home.
- `/api/voice/*`: speech transcription, NeuTTS synthesis, streaming synthesis events, and generated audio file serving.
- `/api/config`, `/api/profiles/*`, `/api/identity/*`, `/api/kanban/*`, `/api/media/*`, `/api/memory/*`, `/api/context-files/*`, `/api/cronjobs/*`: runtime configuration, profile management, identity, local planning, media, memory, context references, and automations.

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
- `server/services/pawrtal.mjs`: WSL Pawrtal command execution, state inspection, autostart, reset, and safe state cleanup
- `server/services/voice.mjs`: voice request pipeline, STT orchestration, NeuTTS server requests, text sanitization, and WAV concatenation

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
- `public/`: runtime static assets bundled with the UI, including Live2D runtime/model assets
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
- `NEUTTS_SERVER_URL`
- `PAWRTAL_CLI_PATH`
- `PAWRTAL_HOME`

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

## Companions And Live2D

Hermes Desktop now separates static branding from interactive characters.

- The sidebar is intentionally clean and wordmark-only.
- The Companions page controls both Pawrtal desktop companions and the detached Live2D avatar.
- Bundled Live2D assets live in `public/live2d-models/` and the browser runtime lives in `public/live2d-runtime/`.
- User-imported Live2D models can be placed in `<Hermes home>/live2d-models/<model-name>/`; models with `.model.json` or `.model3.json` are discovered through `/api/live2d/models`.
- The detached avatar can be invoked, hidden, dragged, resized, snapped to an edge, reset, and switched between available avatars.
- Global shortcuts: `Ctrl+Shift+A` toggles the detached avatar, `Ctrl+Shift+R` resets its position, and `Ctrl+Shift+1` through `Ctrl+Shift+9` select bundled avatar slots.
- During message audio playback, Hermes Desktop emits `hermes:voice:speaking` events. The Live2D overlay listens to those events and drives Cubism 2 or Cubism 4 mouth parameters for lipsync.

## Pawrtal Integration

Pawrtal support is local-first and optional.

- The backend calls `pawrtal` inside WSL using the configured Hermes profile and `HERMES_HOME`.
- The Companions page can list available companions, show active session status, launch a companion, spawn another instance, hide it, switch to a different companion, or reset the current session.
- The Config page exposes `pawrtal.auto_start`, `pawrtal.default_pet_id`, `pawrtal.default_session`, and `pawrtal.reset_before_spawn`.
- Chat shortcuts are supported for common actions, including `/pawrtal <id>`, `/pawrtal hide`, `/pawrtal switch <id>`, and `/pawrtal reset [id]`.

## Voice And TTS

Hermes Desktop uses the backend voice pipeline for microphone input and message speech playback.

- STT still runs through `server/voice_tools.py` and local Python dependencies.
- TTS is handled by an already-running NeuTTS HTTP server, usually on Windows at `http://127.0.0.1:8020`.
- The active provider is `neutts-server`; older Kokoro-specific backend modules and tests were removed.
- The Config page exposes the NeuTTS server URL setting.
- Chat messages can be copied or synthesized directly from the message toolbar, and manual audio playback also drives the avatar speaking events.
- The streaming synthesis endpoint can return each generated segment as soon as it is ready.

Default NeuTTS settings expect a local service at `http://127.0.0.1:8020` with the `POST /tts` endpoint. Hermes Desktop splits longer text into speakable segments, requests audio from NeuTTS, and joins the generated WAV segments for playback.

Example config:

```yaml
tts:
  provider: neutts-server
  neutts_server:
    base_url: http://127.0.0.1:8020
    timeout_ms: 180000
```

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
- TTS audio plays but the avatar does not move: reload the Electron window after rebuilding, make sure Voice is enabled in Chat, verify the detached Live2D avatar is visible, and confirm the model exposes `ParamMouthOpenY` or `PARAM_MOUTH_OPEN_Y`.
- Pawrtal shows as unavailable: install `pawrtal` inside the configured WSL distro or set `PAWRTAL_CLI_PATH`, then use Refresh on the Companions page.
- User Live2D models do not appear: put each model in its own directory under `<Hermes home>/live2d-models/` and include a `.model.json` or `.model3.json` file.
- You see `builder` names in logs, config, or health routes: that is expected compatibility naming, not a second product.

For more detail, see `docs/troubleshooting.md`.

## Documentation

- `docs/desktop-electron.md`
- `docs/troubleshooting.md`
- `docs/repository-notes.md`
- `docs/product-roadmap.md`
- `docs/templates-workspaces-tutorial.md`
- `docs/plans/2026-05-16-live2d-avatar-improvements.md`
- `docs/wsl-windows-workflow.md`
- `CONTRIBUTING.md`
- `SECURITY.md`
- `CODE_OF_CONDUCT.md`

## License

MIT. See `LICENSE`.
