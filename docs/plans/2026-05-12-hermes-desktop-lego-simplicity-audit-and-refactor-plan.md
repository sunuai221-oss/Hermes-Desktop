# Hermes Desktop Lego Simplicity Audit and Refactor Plan

> For Hermes: execute as safe/strangler refactors only. Keep public routes, page entrypoints, and user-visible behavior stable unless explicitly changed in a later product decision.

Date: 2026-05-12
Repo audited: `/mnt/c/Users/GAMER PC/.hermes/hermes-builder`
Package observed: `hermes-desktop@0.1.0`

## Goal

Produce a rigorous audit of Hermes Desktop focused on simplicity, cohesion, separation of concerns, and real wiring between frontend and backend; then convert the findings into a concrete 3-lot safe/strangler refactor plan.

## Executive Summary

Hermes Desktop is globally coherent and functional. The app is not structurally broken, and there is no evidence of widespread dead code causing runtime failure. The main issue is not correctness; it is architectural clarity.

Current state in one line:

- good working product
- decent modular base
- but still too hybrid to be truly lego-simple

High-level verdict:

- Functional coherence: good
- Frontend/backend wiring: mostly coherent
- Product surface clarity: mixed
- Redundancy / legacy: present but partially intentional
- Simplicity / lego quality: medium
- Main risk: cognitive complexity and mixed architectural patterns, not hard runtime failure

## Validation Performed

The audit was grounded on the real repo and validated with project tooling.

### Runtime / quality validation

- `npm test` → 66/66 tests passed
- `npm run lint` → 0 errors, 2 warnings
- `npm run build` → success

### Lint warnings observed

- `src/hooks/chatAudioController.ts:67:6`
- `src/hooks/chatAudioRuntime.ts:64:6`
- Warning text: `React Hook useEffect has a missing dependency: 'params'. Either include it or remove the dependency array`

### Build signals observed

- `2254 modules transformed`
- Main bundle: `dist/assets/index-D4gLFZZI.js` ~207.91 kB
- `ChatPage` chunk ~60.14 kB
- `api` chunk ~43.27 kB
- `WorkspacesPage` chunk ~27.97 kB
- `KanbanPage` chunk ~28.45 kB

Interpretation:
- tests/lint/build confirm the app is operational
- debt is primarily structural, not catastrophic
- complexity is concentrated in a few dense modules

## Verified Architecture Snapshot

Hermes Desktop currently behaves like a 3-layer product:

- Electron shell
- Express backend / local control plane
- React frontend SPA

The architecture direction is sound. The main issue is uneven modularization across features.

## Real Surface Mapping

### Frontend page surface found

23 page components were found under `src/pages`:

- `src/pages/AutomationsPage.tsx`
- `src/pages/ChatPage.tsx`
- `src/pages/ConfigPage.tsx`
- `src/pages/ContextFilesPage.tsx`
- `src/pages/DelegationPage.tsx`
- `src/pages/ExtensionsPage.tsx`
- `src/pages/HomePage.tsx`
- `src/pages/IdentityPage.tsx`
- `src/pages/KanbanPage.tsx`
- `src/pages/PlatformsPage.tsx`
- `src/pages/ProfilesPage.tsx`
- `src/pages/SessionsPage.tsx`
- `src/pages/SkillsPage.tsx`
- `src/pages/TemplatesPage.tsx`
- `src/pages/WorkspacesPage.tsx`
- `src/pages/agent-studio/AgentStudioWorkspaces.tsx`
- `src/pages/agent-studio/components/WorkspaceEditorPanel.tsx`
- `src/pages/agent-studio/components/WorkspaceListPanel.tsx`
- `src/pages/agent-studio/components/WorkspaceRunPanel.tsx`
- `src/pages/agent-studio/components/WorkspaceTemplatePanel.tsx`
- `src/pages/identity/ConversationSearch.tsx`
- `src/pages/identity/MemoryPanel.tsx`
- `src/pages/identity/SoulPanel.tsx`

Interpretation:
- product surface is broader than the primary navigation suggests
- some components under `src/pages` behave more like subviews/panels than top-level pages
- this is not wrong, but it makes the conceptual map noisier

### Backend route surface found

13 route modules were found under `server/routes`:

- `server/routes/agent-studio.mjs`
- `server/routes/agents.mjs`
- `server/routes/api-access.mjs`
- `server/routes/config.mjs`
- `server/routes/context-references.mjs`
- `server/routes/cronjobs.mjs`
- `server/routes/gateway.mjs`
- `server/routes/hooks.mjs`
- `server/routes/kanban.mjs`
- `server/routes/models.mjs`
- `server/routes/plugins.mjs`
- `server/routes/sessions.mjs`
- `server/routes/skills.mjs`

Key routes confirmed in modular route files:

- `/api/agent-studio/*`
- `/api/agents`
- `/api/desktop/health`
- `/api/builder/health`
- `/api/config`
- `/api/context-references/resolve`
- `/api/cronjobs*`
- `/api/gateway/*`
- `/api/hooks`
- `/api/kanban/*`
- `/api/models`
- `/api/plugins`
- `/api/sessions*`
- `/api/skills*`

### Additional route handlers still inline in `server/index.mjs`

Confirmed inline or index-owned backend surfaces include at least:

- `/api/profiles/*`
- `/api/soul`
- `/api/images`
- `/api/voice/*`
- file-management and identity-related surfaces
- memory and context-file related surfaces in the index-owned backend area already inspected during audit

Interpretation:
- backend is only partially modularized
- route ownership is split between route files and the main bootstrap
- this is the clearest structural smell in the app today

## What Is Coherent Today

### 1. The app works

The repo passes tests, lint, and build. This matters because it separates structural debt from hard breakage.

### 2. Frontend shell direction is good

`src/App.tsx` shows a sane shell:

- providers are centralized
- lazy routing is in place
- chat is default landing
- navigation is route-driven
- page remount behavior across profile changes is explicit

### 3. API access is centralized

`src/api.ts` acts as the canonical frontend API surface. Even though the file is large, this is still preferable to API calls scattered everywhere.

### 4. Backend route modularization already exists

The existence of 13 route modules is good evidence that the system is already moving toward composable lego blocks.

### 5. Legacy compatibility is partly intentional, not accidental

Two important examples:

- `/api/gateway/status` is a compatibility alias for `process-status`, documented and tested
- `/api/agents` is preserved for compatibility/tooling/migration and is not used by the current frontend

These should not be mislabeled as dead code without policy review.

## What Is Not Lego-Simple Yet

### 1. `server/index.mjs` still mixes bootstrap and feature ownership

This is the biggest structural issue.

A composition root should mostly do:
- app/bootstrap setup
- middleware setup
- dependency composition
- route mounting
- static serving / dev middleware

Instead, `server/index.mjs` still owns part of the product surface directly.

Why this matters:
- feature location is inconsistent
- developer lookup cost is high
- backend mental model requires searching both route modules and the bootstrap file

### 2. Canonical vs alias vs expert vs legacy is not explicit enough

The app currently contains both canonical routes and alias redirects, for example:

- `/memory` → `/identity`
- `/gateway` → `/config`
- `/providers` → `/config`
- `/plugins` → `/extensions`
- `/hooks` → `/extensions`
- `/agent-studio` → `/workspaces`

This is acceptable technically, but the app lacks a strong documented classification of:
- canonical product surfaces
- compatibility aliases
- expert/internal pages
- backend-only legacy surfaces

That ambiguity increases product and maintenance confusion.

### 3. The chat/runtime core is the main concentration of complexity

Large hotspots identified:

- `src/api.ts` → 351 lines
- `src/hooks/useChat.ts` → 332 lines
- `src/contexts/FeedbackProvider.tsx` → 248 lines
- `src/features/templates/components/TemplatesLibraryPanel.tsx` → 238 lines
- `src/hooks/useGateway.ts` → 179 lines

Interpretation:
- the app is not uniformly complex
- complexity is concentrated in a few central files
- these are the right targets for strangler refactors

### 4. The chat/audio subsystem is fragmented

The audit confirmed multiple specialized chat/audio/voice modules, including:

- `chatAudioController`
- `chatAudioRuntime`
- `chatAudioPlayback`
- `chatVoiceController`
- `chatSpeechPlayback`
- `chatVoiceWorkflow`
- `chatMediaUtils`
- `chatProviderRuntime`

Interpretation:
- this subsystem is not broken
- but its responsibilities are spread across too many nearby modules
- the two lint warnings in the audio area reinforce that this is a local fragility zone

### 5. Session/draft/localStorage behavior is too diffuse

Signals collected during audit:

- heavy presence of chat draft bridge usage
- 25 `localStorage` usages in `src`
- chat opening/resuming logic crosses multiple pages and app shell state

Interpretation:
- the feature works
- but the mechanism is overly transversal
- there is too much implicit glue relative to the desired lego simplicity

### 6. Some data conventions are not fully unified

A concrete example found in the audit:

- `formatRelativeTime(timestamp)` expects seconds
- `HomePage` has a local `getSessionTimestamp()` helper that compensates for millisecond/second ambiguity when sorting
- time normalization is not fully canonicalized in one place

Interpretation:
- not a major bug by itself
- but a real signal of model inconsistency

## Confirmed Redundancies / Technical Smells

### Redundancy A — two gateway access concepts

Signals observed:
- `useGateway(` found in a few call sites
- `useGatewayContext(` found in more call sites

Assessment:
- this is a duplicated access pattern for the same concept
- only one public hook should be canonical

### Redundancy B — alias surface vs canonical surface

Frontend routing includes several redirects that are technically fine but conceptually noisy if undocumented.

Assessment:
- keep them if compatibility matters
- but classify them clearly and stop treating them as equivalent product destinations

### Redundancy C — backend legacy route `/api/agents`

Audit result:
- no frontend usage found under `src`
- route exists in backend and is explicitly marked for compatibility/tooling/migration

Assessment:
- not dead by default
- but definitely not canonical for the current UI

## What I Do Not Classify as Serious Problems

- `src/api.ts` being central and large
- thin façade pages such as `WorkspacesPage`
- expert pages existing at all
- legacy redirects existing at all

These are acceptable if the system clearly labels what is canonical, what is expert, and what is legacy.

## Overall Audit Verdict

Hermes Desktop is a serious, working, mostly coherent app.

It is not a spaghetti system.
It is not a broadly broken app.
It does not appear full of useless code causing runtime failure.

But it is still architecturally hybrid.

The main issue is not “bad code”; it is “too many concepts are only partially separated.”

Short verdict:

- Coherent enough to trust
- Not simple enough to scale comfortably
- Best next move: safe/strangler refactors, not a rewrite

## Refactor Strategy

### Strategy principles

- preserve public routes and public component entrypoints
- extract behind existing façades
- do one cohesive extraction at a time
- validate after each mini-lot
- do not mix product redesign with structural cleanup

### Three-lot priority order

1. Finish backend modular separation and classify product surface
2. Strangler the chat/runtime core and unify chat opening/persistence pathways
3. Clean satellites: audio/voice, feedback, templates, expert/internal page labeling

---

# Concrete Execution Plan

## Lot 1 — Backend canonicalization + route ownership cleanup

Priority: very high
Risk: low to medium
Theme: clarity without behavior change

### Objectives

- make `server/index.mjs` a composition root instead of a half-route-owner
- move remaining inline feature routes to dedicated route modules
- explicitly classify canonical, alias, expert, and legacy surfaces
- normalize session timestamp handling in the frontend

### Scope

Primary files involved:
- `server/index.mjs`
- `server/routes/profiles.mjs` (new)
- `server/routes/identity.mjs` (new)
- `server/routes/context-files.mjs` (new)
- `server/routes/media.mjs` or `server/routes/voice.mjs` (new or expanded)
- `docs/architecture/hermes-desktop-audit-and-refactor-plan.md` or a new surface map doc
- `src/lib/utils.ts`
- `src/pages/HomePage.tsx`
- `src/pages/SessionsPage.tsx`

### Commit order

#### Commit 1
`refactor: extract profile routes from server index`

Tasks:
1. Create `server/routes/profiles.mjs`
2. Move:
   - `GET /api/profiles/metadata`
   - `POST /api/profiles`
   - `DELETE /api/profiles/:name`
3. Keep response shapes unchanged
4. Import and mount the route module from `server/index.mjs`
5. Remove the inline profile handlers from `server/index.mjs`

Quick verification:
- backend still compiles via project tests/build
- routes exist only once outside tests/docs

#### Commit 2
`refactor: extract identity and context file routes from server index`

Tasks:
1. Create `server/routes/identity.mjs`
2. Move:
   - `GET /api/soul`
   - `POST /api/soul`
   - any remaining memory-related identity routes still inline
3. Create `server/routes/context-files.mjs`
4. Move:
   - `GET /api/context-files`
   - `POST /api/context-files`
5. Mount both modules from `server/index.mjs`
6. Remove corresponding inline handlers

Quick verification:
- `src/api.ts` contracts for `soul`, `memory`, and `contextFiles` remain unchanged
- `ContextFilesPage` assumptions remain valid

#### Commit 3
`refactor: extract media routes from server index`

Tasks:
1. Create or extend a route module for media/voice
2. Move:
   - `POST /api/images`
   - `POST /api/voice/respond`
   - `POST /api/voice/synthesize`
   - `POST /api/voice/synthesize/stream`
   - `DELETE /api/voice/audio/:fileName` if still inline
3. Mount the route module from `server/index.mjs`
4. Remove corresponding inline handlers

Quick verification:
- `src/api.ts` media/voice endpoints still match exactly

#### Commit 4
`docs: classify canonical aliases and legacy surfaces`

Tasks:
1. Add or update a doc table listing:
   - canonical frontend routes
   - alias frontend routes
   - expert/internal frontend routes
   - backend-only legacy routes
2. Explicitly classify:
   - `/memory` → alias to `/identity`
   - `/gateway` → alias to `/config`
   - `/providers` → alias to `/config`
   - `/plugins` → alias to `/extensions`
   - `/hooks` → alias to `/extensions`
   - `/agent-studio` → alias to `/workspaces`
   - `/api/agents` → backend legacy only
   - `/api/gateway/status` → compatibility alias

Quick verification:
- one short doc answers “what is canonical?” without needing code search

#### Commit 5
`refactor: normalize session timestamp handling`

Tasks:
1. Add a timestamp normalization helper in `src/lib/utils.ts`
2. Replace `HomePage`’s local timestamp compensation with the canonical helper
3. Verify `SessionsPage` sorting/formatting behavior and normalize if needed

Quick verification:
- time sort and time display remain stable
- no new timestamp ad hoc logic remains in pages

### Lot 1 validation

Run:
- `npm test`
- `npm run lint`
- `npm run build`

Done criteria:
- `server/index.mjs` is mostly bootstrap/composition
- moved routes remain behavior-compatible
- canonical vs alias vs legacy classification exists in docs
- timestamp normalization is centralized

---

## Lot 2 — Strangler the chat/runtime core

Priority: high
Risk: medium
Theme: reduce cross-cutting glue while keeping the chat UX unchanged

### Objectives

- create a canonical way to open/resume chat sessions
- centralize chat-related local storage access
- break `useChat.ts` into cohesive internal modules without changing its public API
- unify the gateway access hook concept

### Scope

Primary files involved:
- `src/App.tsx`
- `src/hooks/useChat.ts`
- `src/contexts/GatewayContext.tsx`
- `src/contexts/GatewayProvider.tsx`
- `src/features/chat/openChatSession.ts` (new)
- `src/features/chat/chatStorage.ts` (new)
- `src/features/chat/useChatSessionState.ts` (new)
- `src/features/chat/useChatStreaming.ts` (new)
- `src/features/chat/useChatAttachments.ts` (new)
- call sites under `HomePage`, `SessionsPage`, and related navigation surfaces

### Commit order

#### Commit 6
`refactor: add canonical chat session opener`

Tasks:
1. Create `src/features/chat/openChatSession.ts`
2. Encapsulate the logic currently spread across app shell state for:
   - session open
   - session resume
   - `requestedSessionId`
   - `requestNonce`
   - navigation to `/chat`
3. Keep `App.tsx` façade behavior unchanged
4. Make `HomePage` and `SessionsPage` rely on the canonical opener path

Quick verification:
- opening a session from Home still lands in Chat
- opening a session from Sessions still lands in Chat

#### Commit 7
`refactor: centralize chat local storage access`

Tasks:
1. Create `src/features/chat/chatStorage.ts`
2. Centralize known chat-related keys and helpers
3. Migrate direct `localStorage` accesses in:
   - `src/api.ts` where profile header lookup relies on local storage
   - `src/hooks/useChat.ts`
   - any obvious adjacent call sites tied to chat session persistence
4. Add short comments classifying each key as preference / session / cache / transient

Quick verification:
- app reload retains active session behavior
- chat persistence behavior is unchanged

#### Commit 8
`refactor: extract chat session orchestration from useChat`

Tasks:
1. Create `src/features/chat/useChatSessionState.ts`
2. Move cohesive session logic out of `src/hooks/useChat.ts`, including:
   - active session selection
   - rehydration
   - reset/new chat behavior
   - resume flow plumbing
3. Keep the exported `useChat` surface stable
4. Make `useChat.ts` delegate to the extracted module

Quick verification:
- Chat page still compiles unchanged
- session switching/resume still works

#### Commit 9
`refactor: extract chat streaming and attachments from useChat`

Tasks:
1. Create `src/features/chat/useChatStreaming.ts`
2. Move stream/send responsibilities out of `useChat.ts`
3. Create `src/features/chat/useChatAttachments.ts`
4. Move image upload / attachment handling out of `useChat.ts`
5. Keep `useChat` as public façade

Quick verification:
- text send still works
- image handling still builds and matches the same endpoints

#### Commit 10
`refactor: unify gateway access hook`

Tasks:
1. Choose one public canonical gateway hook
2. Keep the non-canonical hook as a temporary alias or internal helper only
3. Migrate easy call sites to the canonical hook
4. Add a short note or comment clarifying canonical access

Quick verification:
- no behavior change in App shell, Home, or runtime-status consumers
- duplication of gateway access concept is reduced

### Lot 2 validation

Run:
- `npm test`
- `npm run lint`
- `npm run build`

Manual smoke checks:
- open a session from Home
- open a session from Sessions
- switch profile
- return to Chat
- create a new chat without deleting backend history
- reload the page with an active session

Done criteria:
- chat open/resume path is canonicalized
- chat storage is centralized
- `useChat.ts` becomes a façade over smaller modules
- only one public gateway-access concept remains canonical

---

## Lot 3 — Simplify satellites and finish the noisy edges

Priority: medium
Risk: low to medium
Theme: remove friction from secondary subsystems without product redesign

### Objectives

- resolve the audio hook lint warnings
- reduce fragmentation in the audio/voice area
- split `FeedbackProvider` internals
- reduce density in `TemplatesLibraryPanel`
- clearly frame expert/internal pages as non-core surfaces

### Scope

Primary files involved:
- `src/hooks/chatAudioController.ts`
- `src/hooks/chatAudioRuntime.ts`
- `src/hooks/chatAudioPlayback.ts`
- `src/hooks/chatVoiceController.ts`
- `src/hooks/chatSpeechPlayback.ts`
- `src/hooks/chatVoiceWorkflow.ts`
- `src/hooks/chatMediaUtils.ts`
- `src/hooks/chatProviderRuntime.ts`
- `src/contexts/FeedbackProvider.tsx`
- `src/contexts/feedback/*` (new)
- `src/features/templates/components/TemplatesLibraryPanel.tsx`
- `src/features/templates/components/*` (new focused subcomponents)
- `src/hooks/useNavigation.ts`
- relevant expert/internal page labels

### Commit order

#### Commit 11
`fix: resolve audio hook dependency warnings`

Tasks:
1. Fix the `useEffect` dependency issue in `src/hooks/chatAudioController.ts`
2. Fix the `useEffect` dependency issue in `src/hooks/chatAudioRuntime.ts`
3. Preserve behavior while making dependency intent explicit

Quick verification:
- `npm run lint`
- the two known warnings disappear

#### Commit 12
`refactor: consolidate chat audio responsibilities`

Tasks:
1. Re-group the audio stack into clearer responsibility zones:
   - input/capture
   - request/runtime
   - playback/output
2. Prefer extraction and re-export over mass renaming
3. Add a small barrel file only if it genuinely reduces import noise

Quick verification:
- imports become easier to trace
- audio/voice build remains green

#### Commit 13
`refactor: split feedback provider internals`

Tasks:
1. Extract toast state logic from `FeedbackProvider`
2. Extract confirm modal state logic
3. Extract prompt modal state logic
4. Keep `notify`, `confirm`, and `prompt` unchanged for consumers

Quick verification:
- `useFeedback()` consumers require no call-site changes
- toasts/modals still build and behave correctly

#### Commit 14
`refactor: split templates library panel into focused components`

Tasks:
1. Extract list rendering from `TemplatesLibraryPanel`
2. Extract actions/import/apply UI
3. Extract filter/search UI if present
4. Keep page and hook contracts stable

Quick verification:
- panel file becomes shorter and easier to scan
- templates features still compile and behave the same

#### Commit 15
`chore: tighten expert page classification and labels`

Tasks:
1. Revisit navigation labels and grouping for expert/internal pages
2. Avoid presenting `Context Files`, `Extensions`, and similar pages as core product surfaces unless intentional
3. Keep routes intact, but align labels with actual product role

Quick verification:
- route behavior unchanged
- navigation semantics become clearer

### Lot 3 validation

Run:
- `npm run lint`
- `npm test`
- `npm run build`

Manual smoke checks:
- voice/chat compiles and opens
- Extensions page opens
- Context Files page opens
- Templates and Workspaces still open
- feedback prompts/toasts still work

Done criteria:
- no remaining known audio lint warnings
- audio responsibilities are easier to reason about
- `FeedbackProvider` is no longer a dense all-in-one provider
- templates panel is decomposed into focused components
- expert surfaces are labeled more honestly

---

## Execution Rules

### Rules to follow during implementation

- do not change route paths and route payloads in the same commit as structural extraction
- do not remove aliases while canonicalizing their documentation
- do not rewrite `useChat` in one shot
- extract first, delegate second, delete old code last
- keep each commit behavior-preserving wherever possible

### Minimum verification cadence

After each commit:
- run at least a targeted verification or `npm run build`

After each lot:
- `npm test`
- `npm run lint`
- `npm run build`

### Preferred commit sequence

1. `refactor: extract profile routes from server index`
2. `refactor: extract identity and context file routes from server index`
3. `refactor: extract media routes from server index`
4. `docs: classify canonical aliases and legacy surfaces`
5. `refactor: normalize session timestamp handling`
6. `refactor: add canonical chat session opener`
7. `refactor: centralize chat local storage access`
8. `refactor: extract chat session orchestration from useChat`
9. `refactor: extract chat streaming and attachments from useChat`
10. `refactor: unify gateway access hook`
11. `fix: resolve audio hook dependency warnings`
12. `refactor: consolidate chat audio responsibilities`
13. `refactor: split feedback provider internals`
14. `refactor: split templates library panel into focused components`
15. `chore: tighten expert page classification and labels`

## Final Recommendation

Do not rewrite Hermes Desktop.
Do not expand abstraction layers for their own sake.
Do not mix product redesign with this cleanup.

The right move is a disciplined strangler refactor:
- backend ownership cleanup first
- chat/runtime simplification second
- satellites and expert-surface cleanup third

If executed in this order, the app should become meaningfully simpler without destabilizing the working product.