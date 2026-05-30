# Hermes Desktop Surface Map

Date: 2026-05-28

This map classifies product surfaces without changing routes, redirects,
payloads, or compatibility behavior. It was refreshed against the current
Electron, React and Express tree on 2026-05-28.

Older architecture notes may still mention retired surfaces such as
`/delegation`, `SoulPage`, `profiles.list()` or `/api/agents`. Those are not
mounted in the current app.

## Canonical Frontend Routes

| Route | Surface | Role |
| --- | --- | --- |
| `/chat` | Chat | Primary conversation surface and default product entrypoint |
| `/home` | Home | Overview and recent-session launcher |
| `/sessions` | Sessions | Session history and resume/continue workflows |
| `/templates` | Templates | Template library surface |
| `/workspaces` | Workspaces | Agent Studio workspace surface |
| `/kanban` | Kanban | Task board surface |
| `/identity` | Identity | Soul, memory, and conversation search surface |
| `/config` | Config | Runtime, provider, gateway, and model configuration |
| `/profiles` | Profiles | Profile management |
| `/skills` | Skills | Skill management |
| `/automations` | Automations | Cron/automation management |
| `/platforms` | Platforms | Platform connection/status surface |
| `/companions` | Companions | Canonical companion/Pawrtal surface |
| `/docs` | Docs | Local documentation viewer |

## Frontend Alias Routes

| Alias | Canonical Target | Classification |
| --- | --- | --- |
| `/memory` | `/identity` | Compatibility/product-language alias |
| `/agent` | `/identity` | Compatibility/product-language alias |
| `/gateway` | `/config` | Compatibility/expert alias |
| `/providers` | `/config` | Compatibility/expert alias |
| `/plugins` | `/extensions` | Compatibility/expert alias |
| `/hooks` | `/extensions` | Compatibility/expert alias |
| `/agent-studio` | `/workspaces` | Compatibility alias for the old workspace naming |
| `/pawrtal` | `/companions` | Compatibility alias for the old companion naming |
| `/` | `/chat` | Default landing redirect |

## Expert/Internal Frontend Routes

| Route | Surface | Role |
| --- | --- | --- |
| `/context-files` | Context Files | Expert context inventory/editor |
| `/extensions` | Extensions | Expert plugin/hook management surface |

## Retired Frontend Surfaces

| Former surface | Current status |
| --- | --- |
| `/delegation` / `DelegationPage` | Not mounted in `src/App.tsx`; chat draft handoff is centralized in `src/features/chat/chatDraftBridge.ts`. |
| `/live2d` / `Live2DPage` | No current frontend route; Live2D is integrated through `CompanionsPage` and avatar components. |
| `SoulPage` | Not present in the current route tree; `IdentityPage` is the canonical identity surface. |

## Backend-Only Legacy Or Compatibility Routes

| Route | Classification | Notes |
| --- | --- | --- |
| `/api/gateway/status` | Compatibility alias | Alias for gateway process status behavior |
| `/api/kanban/diagnostics` | Diagnostics route | Kept for board diagnostics and migration checks |
| `/api/agents` | Retired route | Not mounted in the current source tree; newer flows use profiles, workspaces and templates |

## Backend Canonical Route Groups

| Group | Owner |
| --- | --- |
| `/api/profiles/*` | `server/routes/profiles.mjs` |
| `/api/soul`, `/api/memory*` | `server/routes/identity.mjs` |
| `/api/context-files` | `server/routes/context-files.mjs` |
| `/api/images`, `/api/voice/*` | `server/routes/media.mjs` |
| `/api/voice/audio/:fileName` | voice audio cleanup endpoint in `server/routes/media.mjs` |
| `/api/live2d/*` | `server/routes/live2d.mjs` |
| `/api/pawrtal/*` | `server/routes/pawrtal.mjs` |
| `/api/gateway/*` | `server/routes/gateway.mjs` |
| `/api/sessions*` | `server/routes/sessions.mjs` |
| `/api/config` | `server/routes/config.mjs` |
| `/api/agent-studio/*` | `server/routes/agent-studio.mjs` |
| `/api/kanban/*` | `server/routes/kanban.mjs` |
| `/api/desktop/health`, `/api/builder/health` | desktop/builder health probes |
| `/api/skills*`, `/api/hooks`, `/api/plugins`, `/api/cronjobs*`, `/api/models`, `/api/context-references/*` | Existing route modules |
