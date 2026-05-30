# Hermes Desktop - Lot 0 Guardrails for Sessions, Chat, Workspaces, and Profiles

Date: 2026-05-18
Repo: `C:\Users\GAMER PC\.hermes\hermes-builder`

Update 2026-05-28:
- this document still records the original Lot 0 contracts, but the flow map
  below has been refreshed where later lots have already landed
- the shared session state, composer reset, per-node profile editing, and
  workspace run persistence contracts have all moved forward since the first
  draft

## 1. Goal

This document freezes the current contracts around `Sessions`, `Chat`, `Workspaces`, and `Profiles` before the refactor lots start.

Lot 0 must provide:
- a precise flow map
- explicit invariants
- a frozen source-label policy
- the exact planned file touch-set per later lot
- manual validation scenarios
- backend test guardrails where patterns already exist

## 2. Reference Surfaces and Contracts

### Frontend references

- `src/features/sessions/SessionsContext.tsx`
  - owns the shared session map used by `Home`, `Sessions`, and gateway-adjacent consumers
- `src/contexts/GatewayProvider.tsx`
  - owns runtime/gateway state and overlays the shared session snapshot for compatibility consumers
- `src/features/chat/hooks/useChatSession.ts`
  - owns active chat session hydration, transcript loading, composer reset on session changes, and local transcript caching
- `src/pages/SessionsPage.tsx`
  - owns list/filter/export/prune/delete/rename flows for persisted sessions
- `src/pages/HomePage.tsx`
  - reads recent sessions from `useSessions()` and opens them in `Chat`
- `src/pages/agent-studio/AgentStudioWorkspaces.tsx`
  - owns workspace editing, execution, prompt generation, and send-to-chat flows

### Backend references

- `server/routes/sessions.mjs`
  - canonical route group for listing, creating, continuing, resuming, exporting, pruning, and reading transcripts
- `server/routes/agent-studio.mjs`
  - decides which workspace execution routes are persisted vs non-persistent
- `server/services/session-store.mjs`
  - canonical session/message persistence helpers
- `server/services/agent-studio.mjs`
  - canonical workspace execution semantics for `prompt`, `delegate`, and `profiles`

## 3. Frozen Flow Map

### 3.1 Sessions -> Home

Current path:
1. Backend sessions are listed through `GET /api/sessions`.
2. `SessionsProvider.refreshSessions()` calls `api.sessions.list()`.
3. `SessionsProvider`, exported from `src/features/sessions/SessionsContext.tsx`, stores the shared session map.
4. `GatewayProvider` exposes that snapshot on gateway state for compatibility consumers.
5. `HomePage` reads `useSessions().sessions`, sorts by activity, and truncates to 4 recent sessions.
6. Clicking a recent session calls `onOpenSessionInChat(id)`.
7. `App.tsx` routes that request into `openChatSession()`.
8. `ChatPage` receives `requestedSessionId` and `requestNonce`.
9. `useChatSession` hydrates the chosen transcript.

Files:
- `src/features/sessions/SessionsContext.tsx`
- `src/contexts/GatewayProvider.tsx`
- `src/pages/HomePage.tsx`
- `src/App.tsx`
- `src/features/chat/openChatSession.ts`
- `src/features/chat/hooks/useChatSession.ts`

### 3.2 Sessions -> Chat

Current path:
1. `SessionsPage` reads the shared session store through `useSessions()`.
2. The page filters the shared session map by `source`, `workspace_id`, and search text.
3. Clicking `Open in Chat` or the row title calls `onOpenSessionInChat(id)`.
4. `App.tsx` updates `chatSessionRequest`.
5. `ChatPage` receives the request and passes it to `useChat`.
6. `useChatSession` calls `api.sessions.transcript(sessionId)` and replaces chat messages with the persisted transcript.

Current behavior:
- when the requested session id changes, `useChatSession` resets transient composer state before hydrating the transcript

Files:
- `src/pages/SessionsPage.tsx`
- `src/App.tsx`
- `src/features/chat/openChatSession.ts`
- `src/hooks/useChat.ts`
- `src/features/chat/hooks/useChatSession.ts`

### 3.3 Workspaces -> Chat

There are two distinct current flows.

#### A. Chat toolbar workspace import

Current path:
1. `ChatPage` loads workspace definitions with `api.agentStudio.workspaces()`.
2. The toolbar lets the user pick a workspace and click `Start workspace chat`.
3. `ChatPage.importWorkspace()` calls `api.agentStudio.generatePrompt(workspaceId)`.
4. It creates a new persisted session through `api.sessions.create(...)` with source `agent-studio-workspace`.
5. It hydrates that new session in chat.
6. It injects the generated prompt into the composer input.

Files:
- `src/pages/ChatPage.tsx`
- `src/components/chat/ChatToolbar.tsx`
- `src/api.ts`

#### B. Workspaces "Send to Chat" draft bridge

Current path:
1. `useWorkspaceExecution.sendPromptToChat()` generates or reuses a workspace prompt.
2. It stores the prompt in local storage through `setDraft(...)` with source `agent-studio-workspaces`.
3. It navigates to `/chat`.
4. `useChatDraft()` consumes the stored draft once.
5. `useChat.prepareDraftSession()` creates a persisted session through `api.sessions.create(...)` with source `agent-studio-workspace`.
6. It hydrates that new session and injects the prompt into the composer input.

Important distinction:
- `agent-studio-workspaces` is currently a frontend bridge label
- `agent-studio-workspace` is the persisted session label

Files:
- `src/pages/agent-studio/hooks/useWorkspaceExecution.ts`
- `src/features/chat/chatDraftBridge.ts`
- `src/features/chat/hooks/useChatDraft.ts`
- `src/hooks/useChat.ts`
- `src/features/chat/hooks/useChatSession.ts`

### 3.4 Workspaces -> Runs

There are two distinct execution surfaces.

#### A. Runs tab via `/execute`

Current path:
1. `WorkspaceRunPanel` triggers `useWorkspaceExecution.executeWorkspace()`.
2. The frontend calls `POST /api/agent-studio/workspaces/:id/execute`.
3. The route injects the persisted gateway callback.
4. `agent-studio` execution semantics depend on mode:
   - `prompt`: returns `ready` prompt only when called without task-runner semantics
   - `delegate`: persists a session with source `agent-studio-delegate`
   - `profiles`: currently persists gateway calls with source `agent-studio-profile-runtime`
5. Task-runner style executions can create aggregate run sessions with workspace metadata.
6. The frontend stores the immediate response in local component state and can link back to persisted session output when provided.

Files:
- `src/pages/agent-studio/components/WorkspaceRunPanel.tsx`
- `src/pages/agent-studio/hooks/useWorkspaceExecution.ts`
- `server/routes/agent-studio.mjs`
- `server/services/agent-studio.mjs`
- `server/index.mjs`

#### B. Interface tab via `/run`

Current path:
1. `WorkspaceInterfacePanel` sends an isolated task.
2. The frontend calls `POST /api/agent-studio/workspaces/:id/run`.
3. The route uses non-persistent per-call gateway execution for node/LLM calls.
4. `runWorkspaceTask()` executes in task-runner mode.
5. The backend wraps the aggregate task run with `startWorkspaceRunSession` / `finishWorkspaceRunSession`.
6. The local panel shows output/progress and receives persisted run session metadata when available.

Files:
- `src/pages/agent-studio/components/WorkspaceInterfacePanel.tsx`
- `server/routes/agent-studio.mjs`
- `server/services/agent-studio.mjs`

### 3.5 Profiles -> Workspace node

Current path:
1. `ProfilesPage` manages runtime profiles through `api.profiles.metadata()` and profile CRUD/start/stop actions.
2. Workspace node schema already includes `profileName`.
3. Backend workspace execution already uses `profileName` when present and falls back to the active Hermes profile otherwise.
4. `WorkspaceNodeTable` displays `profileName`.
5. `WorkspaceEditorPanel` exposes editable `profileName` controls through the profile runtime helpers.

Files:
- `src/pages/ProfilesPage.tsx`
- `src/pages/agent-studio/components/WorkspaceEditorPanel.tsx`
- `src/pages/agent-studio/components/WorkspaceNodeTable.tsx`
- `src/pages/agent-studio/profileRuntime.ts`
- `server/services/agent-studio.mjs`

## 4. Invariants to Keep or Deliberately Change

### 4.1 Session invariants

- `session.source` is a product-visible dimension.
  - it drives `SessionsPage` source filtering
  - it appears in `HomePage` recent-session metadata
  - it participates in export/prune flows
- `workspace_id` and `workspace_name` are the canonical workspace linkage fields on a session.
- continuation sessions must inherit workspace linkage unless explicitly overridden
- metadata-only updates must not silently drop existing `source`, `workspace_id`, or `workspace_name`

### 4.2 Chat hydration invariants

- `openChatSession()` only transports `sessionId` and `nonce`
- transcript hydration happens inside `useChatSession`
- local transcript cache is best-effort only
- draft bridge payloads are consumed once
- transient composer state must reset when the active persisted session changes

### 4.3 Workspace execution invariants

- `POST /execute` is the persisted execution route
- `POST /run` and the legacy `POST /chat` alias use non-persistent per-node gateway calls but can persist an aggregate task-runner session
- `prompt` mode has two behaviors depending on surface:
  - `/execute`: prompt preparation
  - `/run`: actual task execution
- `delegate` mode persists through the gateway callback
- `profiles` mode already honors per-node `profileName` at execution time

### 4.4 Product invariants

- `Sessions`, `Home`, and `Chat` are about the same underlying domain object and should end at one source of truth
- `Workspaces` may use transient bridge labels internally, but persisted session labels must stay explicit and stable
- if a workspace flow creates a session, it must carry workspace metadata

## 5. Frozen Source-Label Policy

This section freezes label semantics before the refactor.

### 5.1 Persisted session source labels

These labels are allowed in persisted `sessions.source` and must not be renamed casually:

- `api-server`
- `cli`
- `agent-studio-workspace`
- `agent-studio-delegate`
- `agent-studio-profile-runtime`
- `agent-studio-auto-config`
- `agent-studio-workspace-task-runner`

### 5.2 Reserved workspace-run session labels

These labels are part of the workspace execution vocabulary and must stay stable if additional run variants become persisted in later lots:

- none beyond the persisted labels above

### 5.3 Frontend-only bridge labels

These labels are internal bridge semantics and must not be treated as canonical persisted session labels unless a deliberate migration updates filters, exports, and tests:

- `agent-studio-workspaces`
- `legacy-localStorage`

### 5.4 Non-session source-like enums

These existing values belong to other domains and must not leak into `sessions.source`:

- `agency-agents`
- `aliasrobotics-cai`
- `external`
- `gateway`
- `local`
- `profile`
- `project`
- `shared-global`
- `user`

### 5.5 Change rule

Any new or renamed persisted session source label requires:
1. updating this document
2. updating backend tests
3. validating `SessionsPage` source filters
4. validating `HomePage` recent-session labels
5. validating export and prune flows

## 6. Test Guardrails

### Existing backend patterns

The repo already has stable backend test patterns using `node:test` in:
- `server/tests/session-store.test.mjs`
- `server/tests/agent-studio.test.mjs`
- `server/tests/agent-studio-routes.test.mjs`

These tests already cover:
- workspace metadata persistence in sessions
- continuation lineage and recap behavior
- workspace run source labels for `prompt`, `delegate`, and `profiles`
- persisted vs non-persistent callback wiring in `agent-studio` routes

### Frontend test status

No frontend unit-test harness was found in `src/`.
Current Lot 0 guardrails therefore remain:
- backend automated tests
- manual validation scenarios
- explicit contract documentation

### Backend additions in Lot 0

Lot 0 adds or tightens backend checks for:
- auto-config source label and workspace metadata on the gateway call
- source preservation when a session is updated only with other metadata

## 7. Manual End-to-End Validation Matrix

These scenarios are the baseline to execute before any later lot is considered complete.

### Scenario 1 - Home opens the chosen persisted session

1. Start or identify at least two sessions with different titles.
2. Open `Home`.
3. Verify `Recent sessions` displays the expected most recent sessions.
4. Open one session from `Home`.
5. Verify `Chat` opens the selected transcript, not a blank conversation.

Expected current behavior:
- transcript loads correctly
- transient composer state is reset when switching persisted sessions

### Scenario 2 - Sessions filters and workspace linkage

1. Open `Sessions`.
2. Verify source filter options match actual stored `session.source` values.
3. Verify workspace-linked sessions display the workspace pill.
4. Filter by workspace and confirm the list narrows correctly.
5. Export with a workspace filter and confirm the action succeeds.

### Scenario 3 - Sessions -> Chat handoff

1. Open a session from `Sessions`.
2. Confirm `Chat` loads the transcript for that session.
3. Repeat with another session.
4. Observe whether any draft text, attachments, or workspace prompt leaks across handoffs.

Expected current behavior:
- transcript changes
- draft text, attachments, and workspace prompt state should not leak across session handoffs

### Scenario 4 - Chat toolbar workspace import

1. Open `Chat`.
2. Select a workspace in the toolbar.
3. Click `Start workspace chat`.
4. Verify a new session is created with source `agent-studio-workspace`.
5. Verify the session carries `workspace_id` and `workspace_name`.
6. Verify the composer is prefilled with the generated prompt.

### Scenario 5 - Workspaces send-to-chat draft bridge

1. Open a workspace in `Workspaces`.
2. Generate or reuse a prompt.
3. Click `Send to Chat`.
4. Verify navigation to `Chat`.
5. Verify a new persisted session is created with source `agent-studio-workspace`.
6. Verify the prompt appears once in the composer.
7. Refresh `Chat` and confirm the transient draft is not injected again.

### Scenario 6 - Runs tab persisted execution baseline

1. In `Workspaces`, execute a workspace through the `Runs` surface.
2. Verify returned output appears in the panel.
3. Verify persisted session behavior matches the current mode:
   - `delegate` should create a persisted session
   - `profiles` currently persists gateway calls
   - `prompt` via `/execute` returns a prompt-ready state rather than a task-runner session

### Scenario 7 - Interface tab aggregate-run baseline

1. In `Workspaces`, open the `Interface` tab.
2. Run a task.
3. Verify local run output appears in the panel.
4. Verify the run uses non-persistent per-node gateway calls.
5. Verify the aggregate task run produces persisted run session metadata when execution succeeds.

Lot 4 has partially landed here: per-node gateway calls remain isolated, while the aggregate workspace run is persisted.

### Scenario 8 - Profiles to workspace-node baseline

1. Open `Profiles` and note at least one active and one available profile.
2. Open a workspace with node table entries showing `Profile`.
3. Verify profile names can be displayed in the node table if already present in saved data.
4. Verify the node inspector exposes an editable `profileName` field.

Lot 3 has landed for per-node profile editing.

## 8. Exact Planned File Touch-Set by Later Lot

### Lot 1 - Shared session store

Status 2026-05-28: completed through `SessionsProvider`; `GatewayProvider` keeps a compatibility session snapshot.

Planned files:
- `src/hooks/useGateway.ts`
- `src/pages/HomePage.tsx`
- `src/pages/SessionsPage.tsx`
- `src/pages/ChatPage.tsx`
- one new shared session store module under `src/features/sessions/` or `src/contexts/`

### Lot 2 - Composer reset on every handoff

Status 2026-05-28: completed for persisted session id changes in `useChatSession`.

Planned files:
- `src/features/chat/hooks/useChatSession.ts`
- `src/hooks/useChat.ts`
- `src/features/chat/hooks/useChatDraft.ts`
- `src/features/chat/chatDraftBridge.ts`
- `src/pages/ChatPage.tsx`
- possibly `src/features/chat/hooks/useChatContextFiles.ts`
- possibly `src/features/chat/hooks/useChatUploads.ts`

### Lot 3 - Real per-node profile configuration

Status 2026-05-28: completed in the workspace editor/node table flow.

Planned files:
- `src/pages/agent-studio/components/WorkspaceEditorPanel.tsx`
- `src/pages/agent-studio/components/WorkspaceNodeTable.tsx`
- `src/pages/agent-studio/components/WorkspaceRunPanel.tsx`
- `src/pages/agent-studio/hooks/useWorkspaceCrud.ts`
- `src/pages/ProfilesPage.tsx`
- `server/services/agent-studio.mjs`

### Lot 4 - Workspace runs converge into Sessions

Status 2026-05-28: partially completed. `/run` now persists aggregate workspace task-runner sessions while keeping per-node gateway execution non-persistent.

Planned files:
- `server/index.mjs`
- `server/routes/agent-studio.mjs`
- `server/routes/sessions.mjs`
- `server/services/agent-studio.mjs`
- `server/services/session-store.mjs`
- `src/api.ts`
- `src/pages/agent-studio/components/WorkspaceInterfacePanel.tsx`
- `src/pages/agent-studio/components/WorkspaceRunPanel.tsx`
- the shared session store introduced in Lot 1

### Lot 5 - UX and validation hardening

Planned files:
- `src/pages/agent-studio/components/WorkspaceInterfacePanel.tsx`
- `src/pages/agent-studio/components/WorkspaceRunPanel.tsx`
- `src/pages/SessionsPage.tsx`
- `src/pages/HomePage.tsx`
- targeted backend tests under `server/tests/`
- any minimal copy-only adjustments discovered during validation

## 9. Lot 0 Exit Criteria

Lot 0 is done only if:
- invariants are documented
- the flow map is explicit
- source labels are frozen by policy
- the exact future file touch-set is written down
- manual validation scenarios exist before the first runtime refactor
- backend test guardrails are in place where the repo already has patterns
