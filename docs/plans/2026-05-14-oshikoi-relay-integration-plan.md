# Hermes Desktop OshiKoi Relay Integration Plan

Date: 2026-05-14
Repo: `C:\Users\GAMER PC\.hermes\hermes-builder`
Target model for delegation: `gpt-5.3-codex`

## Goal

Integrate Hermes Desktop with the installed OshiKoi browser extension in the simplest viable way:

- Hermes remains the intelligence and orchestration layer
- OshiKoi remains responsible for avatar rendering, presence, voice, and animation
- Hermes sends its final answer to OshiKoi as a relay prompt
- OshiKoi speaks and animates that answer through its own normal chat path

This plan intentionally avoids a deep extension fork or unsupported direct writes into OshiKoi internals for the MVP.

## Product decision locked for this plan

The MVP integration mode is:

1. Hermes generates the assistant answer
2. Hermes formats a relay prompt for OshiKoi
3. Hermes injects or submits that prompt into the OshiKoi chat UI
4. OshiKoi's own backend, TTS, and avatar stack play the result

Strict word-for-word fidelity is not required for the MVP.

## Why this path

- Lowest implementation risk
- No dependency on undocumented OshiKoi storage writes for core flow
- Preserves OshiKoi's strongest value: 3D avatar, voice, and animation
- Keeps Hermes architecture clean: Hermes does not become a browser-side media engine
- Leaves room for a future v2 playback bridge if fidelity becomes important

## Technical constraints and assumptions

- Hermes Desktop backend runs on `3020`
- Hermes gateway runs on `8642`
- OshiKoi is used in Microsoft Edge with an installed extension overlay
- Browser automation or page bridge is acceptable for the MVP
- We do not rely on reading cookies, tokens, or private browser session storage
- We do not call undocumented OshiKoi APIs directly from Hermes for production flow

## Confirmed local Hermes surfaces relevant to this work

- `server/index.mjs`
- `server/routes/pawrtal.mjs`
- `server/services/pawrtal.mjs`
- `server/services/gateway-manager.mjs`
- `server/services/gateway-proxy.mjs`
- `src/api.ts`
- `src/pages/CompanionsPage.tsx`

These files indicate Hermes already has a sidecar-style integration pattern that can be reused for an OshiKoi relay service.

## Architecture target

```text
Hermes UI
  -> Hermes Desktop backend
  -> OshiKoi relay service
  -> browser bridge / automation layer
  -> active OshiKoi tab
  -> OshiKoi AI chat
  -> OshiKoi avatar voice + animation
```

## Non-goals for MVP

- No direct extension fork
- No direct cross-extension messaging contract
- No unsupported manipulation of OshiKoi private auth/session data
- No exact TTS playback injection
- No automatic ingestion of OshiKoi replies back into Hermes as user input

## Global Definition of Done

- Hermes can send a relay message to a live OshiKoi session from the desktop app
- The operator can trigger the relay from a stable Hermes UI surface
- Relay messages are clearly marked internally to prevent feedback loops
- Basic health, status, and error reporting exist in Hermes
- The integration degrades gracefully if no OshiKoi tab is available
- The implementation is documented and covered by targeted tests where practical

---

## Lot 0 - Discovery hardening and execution contract

Objective: freeze the integration contract before feature work begins.

Files:

- Create: `docs/architecture/oshikoi-relay.md`
- Optionally update: `docs/repository-notes.md`

Tasks:

1. Document the MVP contract in writing:
   - Hermes owns intelligence
   - OshiKoi owns presentation
   - relay path is prompt-based, not playback-based
2. Record the anti-loop rule:
   - OshiKoi relay outputs must never be re-ingested as user inputs automatically
3. Record the failure model:
   - no active tab
   - page not loaded
   - chat input not found
   - send action fails
   - OshiKoi response timeout
4. Document known future upgrade path:
   - optional storage/playback bridge based on `oshikoi_last_chat_message`

Acceptance criteria:

- A concise architecture note exists and reflects the chosen MVP mode
- Anti-loop and failure-handling rules are explicit

Out of scope:

- Any runtime code changes

Suggested delegation prompt for `gpt-5.3-codex`:

```text
Create a concise architecture note for an OshiKoi relay integration in Hermes Desktop. The MVP mode is prompt relay only: Hermes generates the answer, OshiKoi speaks it through its own AI/TTS/avatar path. Document responsibilities, anti-loop rules, failure modes, and a future v2 playback-bridge path. Do not change runtime code.
```

---

## Lot 1 - Backend relay service skeleton

Objective: add a clean backend ownership boundary for OshiKoi relay operations.

Files:

- Create: `server/services/oshikoi.mjs`
- Create: `server/routes/oshikoi.mjs`
- Modify: `server/index.mjs`

Tasks:

1. Create an `oshikoi` service module that owns:
   - status shape
   - relay request validation
   - normalized error mapping
2. Create Express routes under `/api/oshikoi/*`
3. Add initial endpoints:
   - `GET /api/oshikoi/health`
   - `GET /api/oshikoi/status`
   - `POST /api/oshikoi/relay`
4. Define a stable request contract for relay:
   - `message`
   - `companionName` or `roomLabel` if needed
   - `mode` defaulting to `relay`
   - `source` metadata for anti-loop tracing
5. Define a stable response contract:
   - `ok`
   - `status`
   - `detail`
   - optional `jobId` or `attemptId`

Acceptance criteria:

- New route exists and is mounted cleanly from `server/index.mjs`
- Service owns business logic and route remains a thin adapter
- Relay request and response contracts are documented in code comments or route-level docs

Out of scope:

- Real browser automation
- UI work

Suggested delegation prompt:

```text
Implement a new OshiKoi backend integration surface in Hermes Desktop. Create server/services/oshikoi.mjs and server/routes/oshikoi.mjs, mount the route from server/index.mjs, and expose GET /api/oshikoi/health, GET /api/oshikoi/status, and POST /api/oshikoi/relay. Keep the route thin and put request normalization and error mapping in the service. Do not implement browser automation yet; return a structured not-implemented or simulated result where appropriate.
```

---

## Lot 2 - Browser bridge adapter

Objective: implement the concrete adapter that can locate and drive an OshiKoi tab.

Recommended implementation direction:

- Prefer a small browser bridge abstraction behind the backend service
- The bridge may initially use browser automation against the active Edge/Chrome session
- Keep the automation details isolated from the route contract

Files:

- Create: `server/services/oshikoi-bridge.mjs`
- Modify: `server/services/oshikoi.mjs`

Tasks:

1. Introduce an adapter layer with methods such as:
   - `findOshikoiTab()`
   - `ensureOshikoiReady()`
   - `sendRelayPrompt(text, options)`
   - `readLastVisibleState()` if practical
2. Start with a safe MVP capability set:
   - detect whether an OshiKoi tab is open
   - detect whether the page appears ready
   - find the message input
   - submit the relay prompt
3. Make the service report structured states:
   - `unavailable`
   - `not_found`
   - `not_ready`
   - `ready`
   - `sending`
   - `sent`
4. Keep the adapter injectable or swappable so a future extension bridge can replace automation without changing the API

Acceptance criteria:

- Hermes backend can distinguish "no OshiKoi tab" from "tab exists but not ready"
- Relay send operation is implemented behind a dedicated adapter
- Core service logic does not depend on page selectors directly

Out of scope:

- Companion UI
- automatic retries beyond basic backoff

Suggested delegation prompt:

```text
Add an adapter layer for OshiKoi browser interaction. Create server/services/oshikoi-bridge.mjs and wire it into server/services/oshikoi.mjs. The bridge should expose methods for detecting an OshiKoi tab, checking readiness, and sending a relay prompt. Keep selectors and browser-driving details inside the bridge and keep the public backend API stable.
```

---

## Lot 3 - Relay prompt builder and anti-loop metadata

Objective: make relay output stable, understandable, and safe from recursive feedback.

Files:

- Create: `server/services/oshikoi-prompt.mjs`
- Modify: `server/services/oshikoi.mjs`

Tasks:

1. Build a dedicated prompt formatter for relay mode
2. Use a relaxed relay prompt, not strict verbatim mode
3. Include invisible or internal metadata in the backend flow to mark outputs as:
   - `source: hermes`
   - `delivery: oshikoi-relay`
   - `relayMode: soft`
4. Ensure the system can later identify relay-originated sends in logs and UI
5. Add input guards:
   - trim empty outputs
   - cap overly long relay payloads
   - normalize whitespace

Suggested initial relay prompt template:

```text
Tu es l'avatar vocal de Hermes.

Lis naturellement le message suivant a l'utilisateur comme si c'etait ta propre reponse.
Garde le sens principal.
Ne parle pas du fait que le message vient d'un autre systeme.

Message:
{{assistant_text}}
```

Acceptance criteria:

- Prompt construction is isolated in its own module
- Relay messages carry enough metadata to support loop prevention and diagnostics
- Empty and oversized payloads are handled predictably

Out of scope:

- Full conversation synchronization back from OshiKoi to Hermes

Suggested delegation prompt:

```text
Create a dedicated OshiKoi relay prompt builder for Hermes Desktop. Add server/services/oshikoi-prompt.mjs and wire it into the OshiKoi service. The prompt should ask OshiKoi to relay Hermes answers naturally without mentioning the upstream system. Also add anti-loop metadata and payload guards for empty, oversized, or noisy content.
```

---

## Lot 4 - Frontend operator surface

Objective: expose OshiKoi status and relay control in the Hermes UI.

Files:

- Modify: `src/api.ts`
- Modify: `src/pages/CompanionsPage.tsx`
- Optional create: `src/features/companions/oshikoi/` submodules if the page needs decomposition

Tasks:

1. Add API client functions:
   - `getOshikoiHealth`
   - `getOshikoiStatus`
   - `postOshikoiRelay`
2. Add a compact operator panel in `CompanionsPage`
3. Minimum UI states:
   - disconnected
   - tab not found
   - ready
   - sending
   - error
4. Allow manual relay send for test purposes
5. Display the last relay attempt summary

Acceptance criteria:

- A user can see whether OshiKoi is reachable from Hermes
- A user can manually submit a relay message from the UI
- Error states are visible and human-readable

Out of scope:

- Final product polish
- automatic conversation coupling

Suggested delegation prompt:

```text
Expose the new OshiKoi backend integration in Hermes Desktop frontend. Update src/api.ts and src/pages/CompanionsPage.tsx to show OshiKoi health/status and allow a manual relay send. Keep the UI compact and operator-focused. Show clear states for disconnected, not found, ready, sending, and error.
```

---

## Lot 5 - Chat pipeline hook-in

Objective: let Hermes optionally relay its generated assistant answers to OshiKoi automatically.

Files:

- Inspect and modify one of:
  - `src/hooks/chatVoice.ts`
  - `src/features/chat/hooks/useChatAudio.ts`
  - chat send/receive orchestration module actually responsible for final assistant output
- Modify: `src/api.ts`

Tasks:

1. Find the stable point where Hermes has the final assistant text
2. Add an optional post-answer hook:
   - only for assistant outputs
   - only if OshiKoi relay is enabled
   - never for relay-generated echoes
3. Add a user-facing toggle or config flag for:
   - `OshiKoi relay enabled`
4. Ensure the relay call is best-effort:
   - Hermes main chat flow must not fail if OshiKoi relay fails
5. Record relay result in logs or UI diagnostics without polluting the main conversation transcript

Acceptance criteria:

- Hermes can auto-relay a finished assistant message to OshiKoi
- Main chat flow remains healthy if OshiKoi is unavailable
- Auto-relay can be disabled cleanly

Out of scope:

- Two-way conversation sync
- OshiKoi-as-input-device behavior

Suggested delegation prompt:

```text
Integrate OshiKoi relay into the Hermes chat pipeline as an optional best-effort post-answer step. Find the stable point where the final assistant text is available, then call the OshiKoi relay API if the feature is enabled. Make sure relay failure never breaks the main Hermes chat flow and that relay-originated content cannot loop back into the pipeline.
```

---

## Lot 6 - Verification, observability, and failure handling

Objective: make the integration safe to operate and easy to debug.

Files:

- Add or modify targeted tests under `server/tests/` and frontend tests if present
- Create: `docs/troubleshooting-oshikoi-relay.md`

Tasks:

1. Add backend tests for:
   - request validation
   - prompt builder behavior
   - health/status response shapes
   - relay failure mapping
2. Add at least one integration-smoke path where possible
3. Add operator troubleshooting notes:
   - no OshiKoi tab
   - page loaded but input not found
   - send button missing
   - timed out after submission
4. Add structured logs around:
   - relay attempt start
   - relay attempt success
   - relay attempt failure

Acceptance criteria:

- New code paths have targeted verification
- Operators have a troubleshooting note
- Failures are diagnosable without deep code inspection

Out of scope:

- End-to-end CI against a real authenticated browser session

Suggested delegation prompt:

```text
Add verification and operational support for the OshiKoi relay integration in Hermes Desktop. Create targeted backend tests for request validation, prompt building, and failure mapping. Add troubleshooting documentation and structured logs so relay failures are visible and diagnosable.
```

---

## Recommended execution order

1. Lot 0
2. Lot 1
3. Lot 2
4. Lot 3
5. Lot 4
6. Lot 6
7. Lot 5

Reasoning:

- Lots 1 to 3 create a clean backend seam first
- Lot 4 gives manual operator control before automatic coupling
- Lot 6 makes the system supportable before full pipeline automation
- Lot 5 is intentionally late because it touches the most user-visible flow

## Suggested PR slicing

PR 1:

- Lot 0
- Lot 1

PR 2:

- Lot 2
- Lot 3

PR 3:

- Lot 4
- Lot 6

PR 4:

- Lot 5

## Risks and mitigations

- Risk: OshiKoi DOM changes break automation
  - Mitigation: isolate selectors in `oshikoi-bridge.mjs` and keep status diagnostics explicit
- Risk: relay call slows or destabilizes Hermes chat
  - Mitigation: best-effort async path with timeout and no hard dependency
- Risk: relay content loops back into Hermes
  - Mitigation: explicit relay metadata and one-way MVP design
- Risk: browser session is unavailable or wrong tab is active
  - Mitigation: status endpoint and manual operator control before auto mode

## V2 backlog, intentionally deferred

- Direct playback bridge using OshiKoi overlay internals
- Better avatar state detection
- Capture avatar snapshots back into Hermes
- Mate selection from Hermes
- Per-companion routing and profiles
- Full browser extension bridge instead of automation

## Final instruction block to hand to `gpt-5.3-codex`

```text
Work inside Hermes Desktop only. Implement the OshiKoi integration as a prompt-relay MVP, not as a direct playback engine. Hermes remains the intelligence layer; OshiKoi remains the avatar/TTS/animation layer.

Constraints:
- keep public Hermes behavior stable unless the lot explicitly changes it
- do not fork or patch the OshiKoi extension for the MVP
- do not read or depend on browser cookies or private session secrets
- keep browser-driving logic isolated behind a bridge/adapter
- prevent relay loops by design
- make relay failures non-fatal to the main Hermes chat flow

Execution order:
1. architecture note
2. backend route/service seam
3. browser bridge adapter
4. prompt builder and anti-loop metadata
5. operator UI
6. tests/troubleshooting
7. optional auto-relay hook in chat pipeline

For each lot:
- keep edits tightly scoped
- preserve existing patterns in the repo
- add targeted tests when the lot changes behavior
- summarize risks, files changed, and verification performed
```
