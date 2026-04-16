# Hermes Builder -> Official Hermes Interface: Phase 1

> For Hermes: implement this phase without rewriting business logic. The local web builder on `localhost:3020` becomes the main interface; the terminal remains an expert mode.

Objective: transform the current UI into the main entry point for interacting with Hermes, centered on chat, session continuity, and reliable runtime status.

Architecture:
- keep the existing Express backend as the local control plane
- keep the Chat page as the foundation, but make it stateful and persistent
- improve the existing SPA navigation without introducing React Router in this phase
- add a light UI feedback layer (toasts + confirm/prompt modals) to move away from `window.*` APIs

Tech stack:
- existing React + TypeScript + Vite
- existing Express backend
- `localStorage` for phase 1 UI persistence

Observed constraints:
- the `hermes-builder` folder is not inside an initialized git repository; commit steps should be ignored until the repo has been initialized
- do not break the Windows/WSL bridge or the existing backend endpoints

---

## Phase 1 Scope

1. Make chat the default home.
2. Recenter navigation around Hermes (chat primary, builder/system secondary).
3. Make runtime status more honest and more stable on the UI side.
4. Persist the active chat session per profile.
5. Allow opening or continuing a session from the sessions explorer into chat.
6. Replace critical `alert/confirm/prompt` flows with a reusable UI feedback layer.

Out of scope for this phase:
- React Router / real application URLs
- Electron packaging
- deep redesign of the Config/Profiles pages
- real-time backend event bus

---

## Target Files

To modify:
- `src/App.tsx`
- `src/components/Sidebar.tsx`
- `src/components/StatusBadge.tsx`
- `src/contexts/ProfileContext.tsx`
- `src/hooks/useGateway.ts`
- `src/pages/ChatPage.tsx`
- `src/pages/SessionsPage.tsx`
- `src/pages/ProfilesPage.tsx`
- `src/pages/SkillsPage.tsx`
- `src/types.ts`

To create:
- `src/contexts/FeedbackContext.tsx`

To verify:
- `src/api.ts`
- `src/components/Header.tsx` if a visual adjustment becomes necessary

---

## Detailed Implementation Plan

### Task 1: Add a global UI feedback layer

Objective: replace critical `window.alert`, `window.confirm`, and `window.prompt` APIs with a consistent solution.

Files:
- Create: `src/contexts/FeedbackContext.tsx`
- Modify: `src/App.tsx`

Steps:
1. Create a React provider that exposes:
   - `notify({title?, message, tone})`
   - `confirm({title, message, confirmLabel?, cancelLabel?, danger?}) => Promise<boolean>`
   - `prompt({title, message?, label?, defaultValue?, placeholder?, confirmLabel?, validate?}) => Promise<string | null>`
2. Render non-blocking toasts in an overlay.
3. Render a confirmation modal.
4. Render a simple input modal.
5. Mount the provider at the root level in `App.tsx`.

Verification:
- the provider compiles
- the UI continues to render normally
- toasts and modals do not interfere with existing navigation

### Task 2: Make chat the default home and persist the active tab

Objective: the product should open on chat and preserve the last visited tab.

Files:
- Modify: `src/App.tsx`
- Modify: `src/components/Sidebar.tsx`

Steps:
1. Initialize `activeTab` from `localStorage`, with `chat` as the fallback.
2. Persist `activeTab` in `localStorage` after each navigation.
3. Reorder the sidebar so `chat` sits at the top of the primary group.
4. Change the main sidebar branding to a less "builder-first" label (for example `Hermes` + `Local Cockpit`).

Verification:
- the initial load opens on Chat
- tab changes persist after reload
- the sidebar clearly renders chat as the primary entry point

### Task 3: Make runtime status more honest

Objective: stop showing a misleading "offline" signal without nuance.

Files:
- Modify: `src/types.ts`
- Modify: `src/components/StatusBadge.tsx`
- Modify: `src/contexts/ProfileContext.tsx`
- Modify: `src/hooks/useGateway.ts`
- Modify: `src/components/Sidebar.tsx`

Steps:
1. Extend `ConnectionStatus` with an additional `direct` or `degraded` state.
2. In `useGateway`, derive a display status that accounts for:
   - the builder backend
   - the gateway proxy
   - the direct gateway probe
   - process status or an existing pid with failed health
3. In `ProfileContext`, reflect this enriched status for the active profile.
4. In `StatusBadge`, map the new states to explicit labels and colors.
5. In the sidebar, display the enriched gateway status instead of simply `gateway.health`.

Verification:
- the badge is coherent when direct gateway access works
- the badge is coherent when a process exists but is not healthy
- no TypeScript crashes are introduced by the new statuses

### Task 4: Persist the active chat session per profile

Objective: chat should survive navigation and simple reloads.

Files:
- Modify: `src/pages/ChatPage.tsx`
- Modify: `src/App.tsx`

Steps:
1. Define a `localStorage` key per profile for the active session.
2. Automatically load the transcript for that session on mount when it exists.
3. Persist `activeSessionId` whenever it changes.
4. Replace the `Clear` button with explicit `New chat` behavior that:
   - clears the visible conversation
   - resets the active UI session
   - does not silently erase backend history
5. Show the current session in the chat header (title or short id) when available.

Verification:
- leaving and returning to Chat keeps the displayed conversation
- reload preserves the active session for the profile
- `New chat` starts cleanly on a fresh empty surface

### Task 5: Enable Sessions -> Chat

Objective: a session must be openable in Direct Chat.

Files:
- Modify: `src/App.tsx`
- Modify: `src/pages/SessionsPage.tsx`
- Modify: `src/pages/ChatPage.tsx`

Steps:
1. Introduce an app-level callback such as `openSessionInChat(sessionId)`.
2. Pass that callback to `SessionsPage`.
3. Add to the sessions explorer:
   - an `Open in Chat` button on each session
   - a `Continue in Chat` button for the most recent or resumed session that is shown
4. In `ChatPage`, listen for open requests and hydrate the targeted transcript.

Verification:
- clicking from Sessions correctly opens Chat
- the correct transcript is displayed
- the active session state follows the current profile

### Task 6: Replace critical confirm/prompt/alert calls in the touched pages

Objective: move away from the "internal tool" feel.

Files:
- Modify: `src/pages/SessionsPage.tsx`
- Modify: `src/pages/ProfilesPage.tsx`
- Modify: `src/pages/SkillsPage.tsx`

Steps:
1. Replace:
   - prune prompt/confirm in Sessions
   - delete session alert/confirm in Sessions
   - rename/export/resume alert in Sessions
   - delete profile confirm/alert in Profiles
   - delete skill confirm in Skills
2. Use `notify`, `confirm`, and `prompt` from the global provider.
3. Keep the existing inline error messages when they are already present.

Verification:
- there are no more `window.alert`, `window.confirm`, or `window.prompt` calls on the touched critical flows
- feedback is coherent and non-blocking

### Task 7: Final verification

Objective: make sure phase 1 is functional.

Files:
- no new logical file

Steps:
1. Run the frontend build.
2. Fix any TypeScript errors.
3. Open the UI and verify manually:
   - home = chat
   - readable runtime status
   - persistent chat session
   - Sessions -> Chat flow
   - working modals and toasts
4. Verify that no touched critical page regresses.

Verification commands:
- `npm run build`
- if necessary: `npm run dev`

Acceptance criteria:
- the app opens on Chat
- chat becomes usable as the main surface
- the active session survives simple navigation
- the sessions explorer opens a conversation in Chat
- UI statuses are more honest
- touched critical flows no longer use `window.alert/confirm/prompt`

---

## Recommended Execution Order

1. Feedback context
2. Default chat + sidebar
3. Enriched runtime status
4. Chat session persistence
5. Sessions -> Chat
6. Replace native dialogs
7. Build + validation

---

## Anticipated Risks

- `ChatPage.tsx` is large; prefer targeted helpers over a large rewrite.
- The current navigation without a router requires coordination through props and `localStorage`; do not introduce unnecessary complexity.
- Gateway status must remain honest: do not mark it as "online" if only a process trace exists without real health.
- UI persistence must never delete backend history without explicit action.

---

## Start of Implementation

Start immediately with:
1. create `FeedbackContext.tsx`
2. wire the provider into `App.tsx`
3. move the home route to `chat`
4. persist the active tab
5. reconnect `ChatPage` and `SessionsPage`
