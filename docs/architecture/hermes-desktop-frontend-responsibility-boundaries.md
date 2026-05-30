# Hermes Desktop - Frontend Responsibility Boundaries

Date: 2026-05-28
Repo: `C:\Users\GAMER PC\.hermes\hermes-builder`

This document clarifies the intended frontend ownership boundaries for the
largest or most coordination-heavy surfaces:
- `src/hooks/useChat.ts`
- `src/pages/agent-studio/AgentStudioWorkspaces.tsx`
- `src/pages/KanbanPage.tsx`
- `src/pages/ConfigPage.tsx`

The goal is not to force every file below an arbitrary line count. The goal is
to make each surface answer one question clearly:

> Is this file a page shell, a feature orchestrator, a domain hook, a presentational component, or a pure helper?

## 1. Shared Rules

### 1.1 Page shells

A page shell may:
- compose feature hooks and panels
- own local tab/view mode state
- connect app-level navigation, guards, and route callbacks
- pass domain state down as props
- decide which empty/loading/error panel is visible

A page shell must not:
- encode backend payload normalization
- own reusable domain mutations
- contain large presentational subtrees that can be named as panels
- contain pure formatting, palette, or diff algorithms that have no React state
- know storage keys or compatibility details unless it is the only boundary that can own them

### 1.2 Feature hooks

A feature hook may:
- own API calls for one domain workflow
- normalize backend responses for the UI
- own loading/saving/error state for that workflow
- expose explicit commands such as `load`, `save`, `delete`, `execute`, `assign`

A feature hook must not:
- render UI
- know route layout
- own visual state such as open panels unless that state is intrinsic to the workflow
- silently mix unrelated domains

### 1.3 Presentational components

A presentational component may:
- render a stable UI surface from props
- own small local UI state such as an active inner tab, collapse state, or field draft
- emit explicit callbacks for domain actions

A presentational component must not:
- call `api.*` directly
- read global contexts directly, unless it is a deliberate cross-cutting shell
- mutate parent domain objects except through callbacks

### 1.4 Pure helpers

Pure helpers should own:
- formatting
- palette and visual mapping constants
- diff planning
- payload shaping that is deterministic and side-effect free

Pure helpers should live close to the feature first. Promote them only when two
features truly share them.

## 2. `useChat.ts`

Current size: about 342 lines. This is already much healthier than the original
audit state because most behavior now lives in `src/features/chat/hooks/*`.

### Current role

`useChat.ts` is a facade hook. It composes chat sub-hooks and returns the stable
surface consumed by `ChatPage`.

It currently owns:
- gateway/profile/session dependency wiring
- preferred model/provider derivation
- composer transient state: input, voice mode, upload/context reset
- workspace draft session preparation
- Pawrtal auto-start side effect
- return-shape compatibility for `ChatPage`

### Canonical owners

| Responsibility | Owner |
| --- | --- |
| persisted session hydration and new chat reset | `src/features/chat/hooks/useChatSession.ts` |
| message send/stream/append behavior | `src/features/chat/hooks/useChatMessages.ts` |
| image upload and paste/drop handling | `src/features/chat/hooks/useChatUploads.ts` |
| context reference attach/resolve/build | `src/features/chat/hooks/useChatContextFiles.ts` |
| voice recording/playback/synthesis state | `src/features/chat/hooks/useChatAudio.ts` |
| one-shot draft consumption | `src/features/chat/hooks/useChatDraft.ts` |
| local slash commands | `src/features/chat/hooks/useChatLocalCommands.ts` |
| token/context window estimates | `src/features/chat/hooks/useChatTokenEstimates.ts` |
| storage key construction | `src/features/chat/chatStorage.ts` |
| draft storage compatibility | `src/features/chat/chatDraftBridge.ts` |

### Boundary rule

`useChat.ts` should remain a facade. It may coordinate sub-hooks, but new chat
features should first ask: "Can this be a focused hook under
`src/features/chat/hooks/`?"

### Next extraction candidates

1. `useChatComposer`
   - Own `input`, text reset, attachment reset, image reset, and voice composer reset.
   - Keep `useChat.ts` responsible only for wiring the returned composer API.
2. `useWorkspaceDraftSession`
   - Own `agent-studio-workspaces` draft handling and session creation metadata.
   - Keep the source-label policy near the sessions/workspaces contracts.
3. `useChatCompanionAutostart`
   - Own Pawrtal config parsing and auto-start side effects.
   - Keep companion lifecycle separate from core message send/hydration.

### Guardrails

- `useChat.ts` public return shape should remain stable unless `ChatPage` is
  changed in the same lot.
- `useChat.ts` should not call raw `localStorage`.
- `useChat.ts` should not gain direct backend calls outside clearly named
  domain bridges such as session creation or companion auto-start.

## 3. `AgentStudioWorkspaces.tsx`

Current size: about 1112 lines. The file is already split into panels and
hooks, but it still owns several domain workflows that can be named more
clearly.

### Current role

`AgentStudioWorkspaces.tsx` is a workspace page shell plus an orchestration
layer.

It currently owns:
- quick/advanced mode and tab selection
- navigation guard for unsaved workspace drafts
- DnD zoom modifier and canvas-level drag invalidation
- template library wiring
- workspace CRUD hook wiring
- execution hook wiring
- team gallery to saved workspace creation
- auto-config preview, diff planning, apply/save behavior
- high-level layout and metrics

### Canonical owners

| Responsibility | Owner |
| --- | --- |
| workspace list, active draft, dirty tracking, node/edge CRUD | `src/pages/agent-studio/hooks/useWorkspaceCrud.ts` |
| prompt generation, copy, send-to-chat, execute, open run session | `src/pages/agent-studio/hooks/useWorkspaceExecution.ts` |
| template library data/search/import | `src/features/templates/hooks/useTemplatesLibrary.ts` |
| template browsing panel | `src/pages/agent-studio/components/WorkspaceTemplatePanel.tsx` |
| canvas, inspector, node/edge editing UI | `src/pages/agent-studio/components/WorkspaceEditorPanel.tsx` |
| node table view | `src/pages/agent-studio/components/WorkspaceNodeTable.tsx` |
| task runner UI | `src/pages/agent-studio/components/WorkspaceInterfacePanel.tsx` |
| execution result UI | `src/pages/agent-studio/components/WorkspaceRunPanel.tsx` |
| quick-start team definitions | `src/pages/agent-studio/teams/teamDefinitions.ts` |

### Boundary rule

`AgentStudioWorkspaces.tsx` should only coordinate page modes, app navigation,
guards, and panel composition. Any operation that produces a workspace patch,
calls the backend, or transforms templates into workspace nodes should live in a
hook or pure helper.

### Next extraction candidates

1. `workspaceAutoConfig.ts` or `useWorkspaceAutoConfig`
   - Move `WORKSPACE_FIELD_LABELS`, `NODE_FIELD_LABELS`, diff value formatting,
     edge signatures, `buildWorkspaceAutoConfigPlan`, preview generation, and
     apply/save behavior.
   - Keep the page responsible for showing the preview panel only.
2. `useTeamWorkspaceCreation`
   - Move team resolution, ambiguity/missing-agent handling, draft construction,
     and create-from-team state.
   - Keep `TeamGallery` purely presentational.
3. `WorkspacePageHeader` / `WorkspaceMetrics`
   - Move hero and metric rendering once the behavioral extractions are done.

### Guardrails

- Unsaved-change confirmation stays at the page shell boundary because it
  crosses navigation, tab changes, delete, quick-start, and task runner entry.
- Template data must continue to come from `useTemplatesLibrary`; do not
  reintroduce a second library implementation.
- Session-opening behavior stays explicit through `onOpenSessionInChat` so the
  page remains reusable inside route shells.

## 4. `KanbanPage.tsx`

Current size: about 1199 lines. This is the least separated of the four
surfaces: domain state, API calls, DnD behavior, form state, task detail
mutations, palette helpers, and presentation all live in one file.

### Current role

`KanbanPage.tsx` is currently both a page shell and the full Kanban feature
implementation.

It currently owns:
- board list/current board loading
- tasks/stats/assignees loading
- selected task detail loading
- task creation form state
- task mutation actions: assign, comment, complete, block, unblock, archive, reclaim
- drag-and-drop status transitions with optimistic local update
- search/archive filters and task bucketing
- lane palette and status formatting
- all lane/card/form/detail UI components

### Target owners

| Responsibility | Target owner |
| --- | --- |
| board/tasks/stats/assignees loading and refresh | `src/pages/kanban/hooks/useKanbanBoard.ts` |
| selected task detail and task actions | `src/pages/kanban/hooks/useKanbanTaskDetail.ts` |
| new task form state and payload shaping | `src/pages/kanban/hooks/useKanbanTaskForm.ts` |
| DnD status transition orchestration | `src/pages/kanban/hooks/useKanbanDrag.ts` or inside `useKanbanBoard` if kept small |
| lane palette, labels, date/payload formatting | `src/pages/kanban/kanbanPresentation.ts` |
| board lanes and task cards | `src/pages/kanban/components/KanbanBoard.tsx` |
| top toolbar/search/stats | `src/pages/kanban/components/KanbanToolbar.tsx` |
| selected task detail/actions/history | `src/pages/kanban/components/KanbanTaskPanel.tsx` |
| new task form/modal | `src/pages/kanban/components/KanbanTaskForm.tsx` |

### Boundary rule

`KanbanPage.tsx` should become a page shell that composes:
- one board state hook
- one selected-task hook
- one form hook
- three or four named UI panels

It should not call `api.kanban.*` directly after the split.

### Extraction order

1. Extract pure presentation helpers and constants first.
   - `LANES`, `ARCHIVED_LANE`, `getLane`, `formatTs`, `formatPayload`.
2. Extract leaf UI components without behavior changes.
   - `Lane`, `TaskCard`, `StatPill`, `StatusBadge`, `Field`, `TextArea`, `Chip`.
3. Extract `useKanbanBoard`.
   - Keep the current API behavior, including silent refresh and optimistic DnD revert.
4. Extract `useKanbanTaskDetail`.
   - Move selected task loading and `mutateSelectedTask`.
5. Extract `useKanbanTaskForm`.
   - Move `emptyForm`, `splitCsv`, create payload shaping and reset.
6. Reduce `KanbanPage.tsx` to composition.

### Guardrails

- Keep board selection as an explicit input to every backend mutation.
- Preserve the optimistic drag update and revert-on-error behavior.
- Do not move profile or board isolation assumptions into UI components; that
  belongs behind `api.kanban` and backend board semantics.
- Do not let task detail components call `api.kanban` directly.

## 5. `ConfigPage.tsx`

Current size: about 865 lines. The page mixes config form editing, runtime
status display, diagnostics commands, command-output formatting, and many
settings sections.

### Current role

`ConfigPage.tsx` is currently both a page shell and the full runtime/config
feature implementation.

It currently owns:
- config load/save
- nested config mutation helper
- runtime status summary
- diagnostics health/logs/doctor/dump/backup state and commands
- diagnostics output formatting
- terminal/container/model/reset/streaming/display/general/pawrtal/TTS/delegation/memory sections
- generic form controls

### Target owners

| Responsibility | Target owner |
| --- | --- |
| config load/save and nested update | `src/pages/config/hooks/useConfigForm.ts` |
| diagnostics state and commands | `src/pages/config/hooks/useGatewayDiagnostics.ts` |
| diagnostics output formatting | `src/pages/config/diagnosticsFormatting.ts` |
| runtime status bar | `src/pages/config/sections/RuntimeStatusSection.tsx` |
| diagnostics card | `src/pages/config/sections/DiagnosticsSection.tsx` |
| terminal backend fields | `src/pages/config/sections/TerminalConfigSection.tsx` |
| container resource fields | `src/pages/config/sections/ContainerResourcesSection.tsx` |
| model/provider fields | `src/pages/config/sections/ModelConfigSection.tsx` |
| reset/streaming/display/general settings | focused `*ConfigSection.tsx` components |
| Pawrtal/TTS/delegation/memory settings | focused `*ConfigSection.tsx` components |
| generic field/toggle/action controls | `src/pages/config/components/*` if they remain config-specific |

### Boundary rule

`ConfigPage.tsx` should not know the internals of every config subtree. It
should load the config form hook, render save/loading state, and compose
sections.

Each section should receive:
- the relevant config subtree
- an `update(path, value)` callback or a section-specific callback
- any loading/status props it needs

Sections should not call `api.config` directly.

### Extraction order

1. Extract diagnostics formatting.
   - This is pure and low-risk.
2. Extract `useGatewayDiagnostics`.
   - Move health/logs/doctor/dump/backup state and commands.
3. Extract `useConfigForm`.
   - Move `api.config.get`, `api.config.save`, `update`, `updateTts`, `saving`, `saved`.
4. Extract generic config controls.
   - `Field`, `Toggle`, `ActionButton`, `SectionTitle`.
5. Extract sections one at a time.
   - Start with diagnostics, then terminal/container/model, then display/general/Pawrtal/TTS/delegation/memory.
6. Leave `ConfigPage.tsx` as a shell with save bar, runtime status, and section layout.

### Guardrails

- Preserve nested update semantics. Config writes should still produce one full
  `HermesConfig` payload through `api.config.save`.
- Diagnostics commands should remain independent from config save state.
- Runtime status should continue to derive from `useRuntimeStatus(gateway)`;
  do not duplicate the status normalization in config sections.

## 6. Cross-Surface Dependency Rules

### Allowed dependencies

| From | May depend on |
| --- | --- |
| page shell | contexts, route callbacks, feature hooks, presentational panels |
| feature hook | `api.ts`, types, pure helpers, feature-local storage/formatting helpers |
| presentational component | types, pure presentation helpers, child components |
| pure helper | types and constants only |

### Discouraged dependencies

| Dependency | Why |
| --- | --- |
| presentational component -> `api.ts` | hides domain mutations inside UI |
| page shell -> raw storage keys | makes navigation/data handoff implicit |
| config section -> `api.config.save` | creates multiple write paths for one config document |
| Kanban UI component -> board/profile selection logic | risks breaking board isolation |
| chat sub-hook -> unrelated page route navigation | makes chat behavior hard to reuse |

## 7. Practical Refactor Sequence

Recommended next lots:

1. Kanban pure helpers and leaf components.
2. Kanban domain hooks.
3. Config diagnostics hook and formatting helper.
4. Config form hook and sections.
5. Agent Studio auto-config extraction.
6. Agent Studio team-workspace creation extraction.
7. Optional Chat polish extractions: composer, workspace draft session, companion auto-start.

This order tackles the least separated surfaces first while keeping the already
improved Chat and Agent Studio flows stable.
