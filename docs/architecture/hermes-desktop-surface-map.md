# Hermes Desktop Surface Map

Date: 2026-05-12

This map classifies product surfaces without changing routes, redirects, payloads, or compatibility behavior.

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
| `/` | `/chat` | Default landing redirect |

## Expert/Internal Frontend Routes

| Route | Surface | Role |
| --- | --- | --- |
| `/context-files` | Context Files | Expert context inventory/editor |
| `/extensions` | Extensions | Expert plugin/hook management surface |
| `/delegation` | Delegation | Expert prompt/delegation composer |

## Backend-Only Legacy Or Compatibility Routes

| Route | Classification | Notes |
| --- | --- | --- |
| `/api/agents` | Backend legacy/tooling route | Preserved for compatibility, migration, and tooling; not canonical for the current UI |
| `/api/gateway/status` | Compatibility alias | Alias for gateway process status behavior |

## Backend Canonical Route Groups

| Group | Owner |
| --- | --- |
| `/api/profiles/*` | `server/routes/profiles.mjs` |
| `/api/soul`, `/api/memory*` | `server/routes/identity.mjs` |
| `/api/context-files` | `server/routes/context-files.mjs` |
| `/api/images`, `/api/voice/*` | `server/routes/media.mjs` |
| `/api/gateway/*` | `server/routes/gateway.mjs` |
| `/api/sessions*` | `server/routes/sessions.mjs` |
| `/api/config` | `server/routes/config.mjs` |
| `/api/agent-studio/*` | `server/routes/agent-studio.mjs` |
| `/api/kanban/*` | `server/routes/kanban.mjs` |
| `/api/skills*`, `/api/hooks`, `/api/plugins`, `/api/cronjobs*`, `/api/models`, `/api/context-references/*` | Existing route modules |
