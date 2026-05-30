# Hermes Desktop - Deep Audit: `useChat` and `AgentStudioWorkspaces`

Date: 2026-05-28
Repo: `C:\Users\GAMER PC\.hermes\hermes-builder`

Scope:
- `src/hooks/useChat.ts`
- `src/features/chat/hooks/*`
- `src/pages/ChatPage.tsx`
- `src/pages/agent-studio/AgentStudioWorkspaces.tsx`
- `src/pages/agent-studio/hooks/*`
- `src/pages/agent-studio/components/*`
- relevant API/backend contracts for chat and workspace execution

This is a code/architecture audit, not an implementation change.

## Fix/Verification Status (2026-05-29)

Validation baseline:
- `git diff --check` executed
- `npm test` executed (80/80 passing)

Manual strict pass scope (workspace draft -> chat, refs resolving gate, send-to-chat error/busy, canvas drop at pan/zoom, edges render at pan/zoom, quick/advanced dirty guard, auto-config clear edges) was verified against the implemented runtime paths and hook wiring.

| Finding | Status | Verification |
| --- | --- | --- |
| P1 `useChatDraft` draft/session race | fixed/verified | `useChatDraft` now uses stable refs + one-shot effect (`src/features/chat/hooks/useChatDraft.ts`), session creation unified through `createWorkspaceChatSession` and reused by `useChat` and `ChatPage` (`src/features/chat/createWorkspaceChatSession.ts`, `src/hooks/useChat.ts`, `src/pages/ChatPage.tsx`). |
| P1 unresolved context refs can send | fixed/verified | `resolvingRefs` added to `useChatMessages` contract and `send` guard (`src/features/chat/hooks/useChatMessages.ts`), plumbed from `useChat` (`src/hooks/useChat.ts`). |
| P1 canvas drop ignores pan/zoom | fixed/verified | viewport→canvas conversion now applies both pan and zoom for new-node drops and node drag deltas (`src/pages/agent-studio/hooks/useWorkspaceCrud.ts`), with pan fed back from canvas (`src/pages/agent-studio/components/WorkspaceEditorPanel.tsx`, `src/pages/agent-studio/AgentStudioWorkspaces.tsx`). |
| P1 edges render risk in 0x0 container | fixed/verified | edges moved to a stable full-plane overlay sharing the same pan/zoom transform as nodes (`src/pages/agent-studio/components/WorkspaceEditorPanel.tsx`). |
| P1 `sendPromptToChat` silent failure path | fixed/verified | explicit busy lock + `try/catch/finally` + surfaced error path in `sendPromptToChat` (`src/pages/agent-studio/hooks/useWorkspaceExecution.ts`), UI disabled/spinner wired in run/editor panels. |
| P2 quick/advanced toggle bypasses guard | fixed/verified | transitions now route through `switchWorkspaceModeSafely` and reuse unsaved guard (`src/pages/agent-studio/AgentStudioWorkspaces.tsx`). |
| P2 auto-config cannot clear all relations | fixed/verified | planner now distinguishes `edges` omitted vs explicit `edges: []`, applies replacement, and emits `Relations cleared` diff item (`src/pages/agent-studio/workspaceAutoConfigPlan.ts`). |
| P2 active workspace stale after reload | pending | not addressed in current lots. |
| P2 duplicated workspace-import session creation | fixed/verified | duplicated logic replaced by shared `createWorkspaceChatSession` helper (`src/features/chat/createWorkspaceChatSession.ts`, `src/hooks/useChat.ts`, `src/pages/ChatPage.tsx`). |
| P2 Workspace Interface domain/UI coupling | pending | extraction to `useWorkspaceTaskRunner` still pending. |

## Executive Summary

`useChat` is now mostly a facade and is in decent shape structurally. The
biggest issue is not size; it is lifecycle coupling between draft consumption,
session creation, and changing context values. There is also duplicated
workspace-import session logic between `ChatPage` and `useChat`.

`AgentStudioWorkspaces` is partially decomposed, but still carries too much
workflow logic: auto-config planning, team-to-workspace creation, dirty-route
guards, canvas DnD coordination, and page rendering. The most concrete behavior
risks are in canvas coordinates/edges and implicit prompt-generation error
handling.

Recommended order:
1. Fix the `useChatDraft` lifecycle race.
2. Fix Agent Studio canvas coordinate/edge rendering boundaries.
3. Extract shared workspace-chat session creation.
4. Extract Agent Studio auto-config and team-creation workflows.

## Findings

### P1 - `useChatDraft` can consume a draft, create a session, then skip injecting the prompt

Files:
- `src/features/chat/hooks/useChatDraft.ts`
- `src/hooks/useChat.ts`
- `src/features/sessions/SessionsContext.tsx`

Evidence:
- `useChatDraft` consumes storage once, awaits `onDraft`, then sets the input only if the effect has not been cancelled.
- `prepareDraftSession` calls `sessionStore.createSession`, which updates the sessions context.
- `SessionsProvider` memoizes a new context value when `sessions` changes.
- `prepareDraftSession` depends on the whole `sessionStore` object, so its identity can change during that awaited create/hydrate path.

Risk:
- A workspace draft can be consumed and the workspace session can be created,
  but the prompt text may never be inserted into the composer if the effect is
  cleaned up before `setInput(draft.text)` runs.

Recommended fix:
- Make `useChatDraft` keep `onDraft` in a ref and run draft consumption on
  mount/profile route entry, not on callback identity changes.
- Alternatively, make `prepareDraftSession` depend only on stable methods such
  as `createSession`, not on the whole context object.
- Add a focused test around "consume workspace draft -> create session -> input
  contains prompt".

### P1 - Chat can send unresolved context references

Files:
- `src/features/chat/hooks/useChatContextFiles.ts`
- `src/features/chat/hooks/useChatMessages.ts`
- `src/hooks/useChat.ts`

Evidence:
- context refs resolve asynchronously after `attachments` changes
- `send` blocks on streaming/uploading/voice state, but not on `resolvingRefs`
- `useChat` does not pass `resolvingRefs` into `useChatMessages`

Risk:
- A user can add `@file`, `@folder`, `@diff`, etc. and immediately send. The
  message may include the fallback "Analyze the attached context references..."
  but not the resolved context body.

Recommended fix:
- Add `resolvingRefs` to the message send guard.
- Disable the send button or make `send` await the current resolution promise.
- Prefer explicit "context resolution pending" state in `ChatInput`.

### P1 - Agent Studio canvas drop math ignores pan and zoom for new nodes

Files:
- `src/pages/agent-studio/hooks/useWorkspaceCrud.ts`
- `src/pages/agent-studio/components/WorkspaceEditorPanel.tsx`
- `src/pages/agent-studio/AgentStudioWorkspaces.tsx`

Evidence:
- `WorkspaceCanvas` owns `pan` locally.
- `useWorkspaceCrud.handleDragEnd` computes new node position from viewport
  rects and clamps to canvas dimensions.
- existing node movement divides `event.delta` by zoom, but new library drops
  do not subtract pan or divide by zoom.

Risk:
- When the user pans or zooms the canvas, dragging a template onto the canvas
  can create the node at the wrong logical position.

Recommended fix:
- Move all canvas coordinate conversion into the canvas layer, or pass a
  `viewportToCanvasPoint` helper from `WorkspaceCanvas`.
- Keep one owner for pan/zoom/coordinate conversion.

### P1 - Workspace edges may render inside a zero-sized transformed container

Files:
- `src/pages/agent-studio/components/WorkspaceEditorPanel.tsx`

Evidence:
- transformed canvas content uses `width: 0` and `height: 0`
- `WorkspaceEdgesOverlay` renders an absolutely positioned SVG with `h-full w-full`
  inside that container.

Risk:
- Edges can disappear or clip unexpectedly because the SVG viewport inherits a
  zero-sized parent while node cards are absolutely positioned outside it.

Recommended fix:
- Render edges in a full-size canvas overlay sibling that shares the same
  pan/zoom transform.
- Or give the transformed content a stable logical canvas size.
- Add a visual regression/manual check with at least two connected nodes.

### P1 - `sendPromptToChat` performs implicit prompt generation without error state

Files:
- `src/pages/agent-studio/hooks/useWorkspaceExecution.ts`

Evidence:
- `sendPromptToChat` generates a prompt if none exists.
- That path has no `try/catch`, does not set `generating`, and does not call
  `onError` if `saveWorkspace` or `generatePrompt` throws.

Risk:
- "Send to Chat" can fail silently or produce an unhandled rejection in the
  exact path where the user expects the app to route to Chat.

Recommended fix:
- Wrap the implicit generation path like `generatePrompt`.
- Set a busy state or reuse `generating`.
- Surface `Could not generate workspace prompt` through `onError`.

### P2 - Workspace mode toggle bypasses the unsaved-change guard

Files:
- `src/pages/agent-studio/AgentStudioWorkspaces.tsx`

Evidence:
- the hero toggle directly calls `setWorkspaceMode`
- `openQuickStart` exists and does call `confirmUnsavedChanges`

Risk:
- A user can hide an unsaved advanced workspace by switching to Quick Start
  without the same confirmation used elsewhere. It is not immediate data loss,
  but it weakens the mental model around dirty state.

Recommended fix:
- Route the hero toggle through the same safe transition helpers.
- Keep one transition API for quick/advanced mode changes.

### P2 - Auto-config cannot represent "remove all relations"

Files:
- `src/pages/agent-studio/AgentStudioWorkspaces.tsx`

Evidence:
- `buildWorkspaceAutoConfigPlan` only compares/replaces edges when
  `suggestedEdges.length > 0`.

Risk:
- If auto-config intentionally suggests an empty relation set, the UI treats it
  as no relation change and cannot apply the cleanup.

Recommended fix:
- Distinguish `suggestion.edges` omitted from `suggestion.edges` present as an
  empty array.
- If present, compare empty signature against current edges and allow clearing.

### P2 - Active workspace can become stale after reload

Files:
- `src/pages/agent-studio/hooks/useWorkspaceCrud.ts`

Evidence:
- `load` preserves `activeWorkspaceId` if it is truthy, without checking whether
  it exists in the freshly loaded workspace list.

Risk:
- If the active workspace was deleted or changed outside this page, `workspaces`
  may be non-empty while `activeWorkspace` becomes `null`.

Recommended fix:
- On load, keep the current id only if it exists in `nextWorkspaces`; otherwise
  select the first workspace or `null`.

### P2 - Chat workspace-import session creation is duplicated

Files:
- `src/hooks/useChat.ts`
- `src/pages/ChatPage.tsx`

Evidence:
- `useChat.prepareDraftSession` and `ChatPage.importWorkspace` both create
  `agent-studio-workspace` sessions with a titled-first fallback.

Risk:
- Future source-label, title, workspace metadata, or failure behavior can drift
  between toolbar import and workspace Send-to-Chat.

Recommended fix:
- Extract `createWorkspaceChatSession` under `src/features/chat/` or
  `src/features/sessions/`.
- Reuse it from both toolbar import and draft consumption.

### P2 - Workspace Interface mixes domain execution with presentational chat UI

Files:
- `src/pages/agent-studio/components/WorkspaceInterfacePanel.tsx`

Evidence:
- the component owns run token lifecycle, API call, simulated/progressive
  display, agent progress derivation, local chat messages, and all UI.

Risk:
- The panel is hard to test and hard to reuse. Run lifecycle bugs will be fixed
  inside a large UI component instead of a focused hook.

Recommended fix:
- Extract `useWorkspaceTaskRunner`.
- Keep the panel presentational: input, local transcript rendering, progress
  list, clear/open actions.

## `useChat` Architecture Assessment

Current status:
- Good: sub-hooks exist and the facade is readable.
- Good: raw draft storage is hidden behind `chatDraftBridge`.
- Good: streaming persistence is explicit; `/api/gateway/chat/stream` does not
  persist, so `appendMessages` on stream success is intentional.
- Needs work: the facade still owns composer reset, workspace-draft session
  creation, and Pawrtal auto-start.

Recommended target:
- `useChat.ts`: stable facade only.
- `useChatComposer`: transient input/context/image/voice reset surface.
- `useWorkspaceDraftSession`: workspace draft -> persisted session behavior.
- `useChatCompanionAutostart`: Pawrtal config parsing and auto-start side effect.

## `AgentStudioWorkspaces` Architecture Assessment

Current status:
- Good: CRUD and execution hooks exist.
- Good: template library is centralized through `useTemplatesLibrary`.
- Good: panels exist for list/editor/interface/runs/templates.
- Needs work: page still owns auto-config workflow and team workspace creation.
- Needs work: canvas coordinate ownership is split between page/hook/component.

Recommended target:
- `AgentStudioWorkspaces.tsx`: page modes, guards, route callbacks, composition.
- `useWorkspaceAutoConfig`: preview, diff planning, apply/save.
- `useTeamWorkspaceCreation`: team resolution and saved workspace creation.
- `WorkspaceCanvas`: pan/zoom and coordinate conversion owner.
- `useWorkspaceTaskRunner`: Interface run lifecycle.

## Suggested Implementation Lots

### Lot A - Chat draft/session correctness

Files:
- `src/features/chat/hooks/useChatDraft.ts`
- `src/hooks/useChat.ts`
- new helper under `src/features/chat/` or `src/features/sessions/`
- focused tests if a frontend test harness exists later

Actions:
- stabilize draft consumption lifecycle
- extract workspace chat session creation
- block send while context refs resolve

### Lot B - Agent Studio canvas correctness

Files:
- `src/pages/agent-studio/components/WorkspaceEditorPanel.tsx`
- `src/pages/agent-studio/hooks/useWorkspaceCrud.ts`
- `src/pages/agent-studio/AgentStudioWorkspaces.tsx`

Actions:
- centralize pan/zoom coordinate conversion
- render edges in a full-size transformed overlay
- manually verify connected nodes at zoom 50%, 100%, 200%, with pan offset

### Lot C - Agent Studio workflow extraction

Files:
- `src/pages/agent-studio/AgentStudioWorkspaces.tsx`
- new `src/pages/agent-studio/hooks/useWorkspaceAutoConfig.ts`
- new `src/pages/agent-studio/hooks/useTeamWorkspaceCreation.ts`
- optional `src/pages/agent-studio/workspaceAutoConfig.ts`

Actions:
- move auto-config diff planning and apply/save behavior
- move team creation and ambiguity/missing-agent handling
- make page shell mostly composition

### Lot D - Workspace Interface extraction

Files:
- `src/pages/agent-studio/components/WorkspaceInterfacePanel.tsx`
- new `src/pages/agent-studio/hooks/useWorkspaceTaskRunner.ts`

Actions:
- move run lifecycle, token/timer cleanup, API call and progress derivation
- leave UI rendering in the panel

## Validation Notes

Suggested checks after fixes:
- workspace Send-to-Chat creates a session and inserts the prompt every time
- context refs cannot send before resolution
- template drop lands under the cursor at multiple zoom/pan states
- edges remain visible between connected nodes at multiple zoom/pan states
- auto-config can add, replace, and clear relations
- Quick/Advanced mode transitions consistently respect dirty-workspace guard
