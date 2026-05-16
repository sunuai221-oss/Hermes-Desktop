# Hermes Desktop OshiKoi I/O Shell Integration Plan

Date: 2026-05-14
Repo: `C:\Users\GAMER PC\.hermes\hermes-builder`
Target model for delegation: `gpt-5.3-codex`

Supersedes for this use case:

- `docs/plans/2026-05-14-oshikoi-relay-integration-plan.md`

This plan replaces the earlier output-only relay design when the product decision is:

- OshiKoi must be the user-facing input surface for Hermes
- OshiKoi must also be the output surface for Hermes

## Goal

Turn OshiKoi into a bidirectional conversation shell for Hermes:

- the user speaks or types into OshiKoi
- Hermes receives that input as the real user turn
- Hermes generates the response
- OshiKoi speaks and animates the response

Hermes remains the intelligence layer. OshiKoi remains the avatar and presentation layer.

## Key architecture consequence

Once OshiKoi becomes both input and output, the MVP can no longer rely on passive UI automation alone.

Why:

- if the user submits directly into OshiKoi, OshiKoi will talk to its own backend
- that produces duplicate or conflicting assistant behavior
- therefore the human-originated submit path must be intercepted before OshiKoi completes its normal chat request

So the correct MVP is:

1. capture human input inside the OshiKoi page
2. prevent native OshiKoi submit for bridged turns
3. forward the turn to Hermes
4. when Hermes finishes, inject an output relay back through OshiKoi

## Product decision locked for this plan

- Hermes is the brain
- OshiKoi is the shell
- Human input originates in OshiKoi but is routed to Hermes
- Hermes output returns to OshiKoi for voice and animation
- Strict verbatim fidelity is not required for the output relay

## Recommended implementation model

Use a small Hermes-owned browser companion extension for `oshikoi.io`.

Why this is preferred:

- it can intercept real page interactions
- it can observe and control the chat UI directly
- it can communicate with local Hermes backend over `http://127.0.0.1:3020`
- it avoids forking the OshiKoi extension
- it is more stable than trying to drive the whole flow from blind desktop automation

## High-level architecture

```text
User
  -> OshiKoi page UI
  -> Hermes OshiKoi companion extension
  -> Hermes Desktop backend
  -> Hermes gateway / normal chat pipeline
  -> Hermes Desktop backend
  -> companion extension
  -> OshiKoi page UI
  -> OshiKoi AI/TTS/avatar output path
```

## Conversation rules

There are three message classes:

1. `human_input`
   - authored by the real user in OshiKoi
   - must be forwarded to Hermes
   - must not be sent to OshiKoi's backend as a normal user turn

2. `hermes_output`
   - authored by Hermes
   - must be delivered back into OshiKoi
   - may be phrased as a relay prompt so OshiKoi speaks it naturally

3. `bridge_internal`
   - handshake, health, and anti-loop control messages
   - must never appear in visible conversation

## Anti-loop invariants

- Human input captured by the companion extension gets `origin=human`.
- Output injected by Hermes gets `origin=hermes`.
- The companion extension must never treat its own injected output as fresh user input.
- Hermes backend must never re-ingest OshiKoi relay output as another user turn.
- Every bridged message gets a unique `bridgeEventId`.

## Non-goals for MVP

- No deep patch of the OshiKoi extension
- No direct cross-extension messaging contract with OshiKoi internals
- No dependence on reading browser cookies or secret session stores
- No exact assistant playback injection into OshiKoi's private extension state
- No full transcript synchronization back from OshiKoi history

---

## Lot 0 - Contract and state model

Objective: freeze the message lifecycle before implementation.

Files:

- Create: `docs/architecture/oshikoi-io-shell.md`

Tasks:

1. Document the bidirectional bridge contract.
2. Define the event envelope:
   - `bridgeEventId`
   - `sessionId`
   - `roomId`
   - `origin`
   - `kind`
   - `text`
   - `createdAt`
3. Define allowed origins:
   - `human`
   - `hermes`
   - `bridge`
4. Define bridge state machine:
   - `disconnected`
   - `page_detected`
   - `ready_for_input`
   - `awaiting_hermes`
   - `injecting_output`
   - `error`
5. Write the anti-loop rules explicitly.

Acceptance criteria:

- Architecture note exists
- Message envelope is documented and stable
- Anti-loop logic is explicit enough to implement without guesswork

Suggested delegation prompt:

```text
Create a concise architecture note for a bidirectional OshiKoi shell integration in Hermes Desktop. OshiKoi is the user-facing input and output surface; Hermes is the intelligence layer. Define the message envelope, bridge state machine, and anti-loop invariants. Do not change runtime code yet.
```

---

## Lot 1 - Backend seam for OshiKoi bridge

Objective: create a clean backend ownership boundary for the integration.

Files:

- Create: `server/services/oshikoi.mjs`
- Create: `server/routes/oshikoi.mjs`
- Modify: `server/index.mjs`

Tasks:

1. Add `/api/oshikoi/*` route mounting.
2. Define backend endpoints:
   - `GET /api/oshikoi/health`
   - `GET /api/oshikoi/status`
   - `POST /api/oshikoi/input`
   - `POST /api/oshikoi/output`
   - `GET /api/oshikoi/events`
3. Keep route thin and move normalization into the service.
4. Create in-memory bridge session state for MVP:
   - active session
   - last event id
   - pending output queue
   - bridge readiness flags
5. Define stable JSON response contracts for all endpoints.

Acceptance criteria:

- Route exists and is mounted cleanly
- Service owns the state model and validation
- Endpoint contracts are stable and documented in code

Suggested delegation prompt:

```text
Implement a new backend integration seam for OshiKoi in Hermes Desktop. Create server/services/oshikoi.mjs and server/routes/oshikoi.mjs, mount them from server/index.mjs, and expose health, status, input, output, and events endpoints. Keep the route thin and put validation, session state, and response shaping in the service.
```

---

## Lot 2 - Companion extension scaffold

Objective: create a Hermes-owned browser companion extension for `oshikoi.io`.

Files:

- Create: `browser/oshikoi-companion/manifest.json`
- Create: `browser/oshikoi-companion/content.js`
- Create: `browser/oshikoi-companion/README.md`

Tasks:

1. Create a minimal MV3 extension scoped to:
   - `https://oshikoi.io/*`
   - `https://www.oshikoi.io/*`
2. Request only the permissions needed for MVP.
3. Connect the extension to Hermes backend over local HTTP.
4. Add a small runtime bootstrap:
   - detect page readiness
   - identify the chat input area
   - identify the send action
5. Add a documented install path for unpacked local development.

Acceptance criteria:

- Companion extension exists in repo
- Extension loads on `oshikoi.io`
- Extension can talk to local Hermes backend

Out of scope:

- Publishing the extension

Suggested delegation prompt:

```text
Create a local Hermes-owned MV3 companion extension under browser/oshikoi-companion. Scope it to oshikoi.io and make it capable of talking to Hermes Desktop backend on localhost. Add a minimal content script and a README for unpacked install during development.
```

---

## Lot 3 - Input interception path

Objective: capture real user turns from OshiKoi and route them to Hermes instead of OshiKoi backend.

Files:

- Modify: `browser/oshikoi-companion/content.js`
- Modify: `server/services/oshikoi.mjs`

Tasks:

1. Detect the OshiKoi message compose flow.
2. Intercept user submit events before the normal request completes.
3. For bridged turns:
   - read the composed text
   - assign a `bridgeEventId`
   - POST to `/api/oshikoi/input`
   - prevent the native OshiKoi send path
4. Handle the no-text case safely.
5. Handle repeated clicks and duplicate submits safely.
6. Keep the interception logic isolated and easy to retarget if OshiKoi DOM changes.

Acceptance criteria:

- A human-authored message in OshiKoi can be captured by the bridge
- The message reaches Hermes backend as a real input event
- Native OshiKoi submit is prevented for bridged turns

Important note:

This lot is the architectural hinge. If this interception is not solid, the whole input/output shell design collapses into double-response behavior.

Suggested delegation prompt:

```text
Implement the input interception path in the OshiKoi companion extension. Capture human-authored submit events in the OshiKoi chat UI, send the text to Hermes Desktop backend, and prevent the native OshiKoi send from completing for those bridged turns. Make duplicate-submit handling explicit.
```

---

## Lot 4 - Hermes ingestion into normal chat pipeline

Objective: route bridged OshiKoi human input into Hermes as the real user turn.

Files:

- Modify: `server/services/oshikoi.mjs`
- Modify: chat/backend orchestration layer that currently owns normal message submission

Tasks:

1. Identify the narrowest existing backend seam for sending a user turn into Hermes.
2. Reuse the normal Hermes chat path instead of inventing a side channel.
3. Attach source metadata:
   - `inputSource=oshikoi`
   - `origin=human`
4. Store enough correlation state to match the eventual assistant answer back to the originating bridge event.
5. Ensure backend failure returns a clear extension-visible error shape.

Acceptance criteria:

- OshiKoi human input enters Hermes through the normal chat path
- The bridge keeps correlation metadata for later output delivery
- Failure states are explicit and recoverable

Suggested delegation prompt:

```text
Wire OshiKoi human input into the normal Hermes chat pipeline. Reuse the narrowest existing backend seam for user turns, attach source metadata identifying Oshikoi as the origin, and keep enough correlation state to deliver the eventual assistant answer back through the bridge.
```

---

## Lot 5 - Hermes output delivery back to OshiKoi

Objective: send Hermes assistant output back through OshiKoi as the user-facing reply.

Files:

- Create: `server/services/oshikoi-prompt.mjs`
- Modify: `server/services/oshikoi.mjs`
- Modify: `browser/oshikoi-companion/content.js`

Tasks:

1. Build a relaxed relay prompt formatter for OshiKoi.
2. When Hermes produces the assistant answer:
   - format relay prompt
   - queue the output event
   - expose it through `/api/oshikoi/events`
3. In the companion extension:
   - poll or subscribe for pending output events
   - inject the relay prompt into the OshiKoi input
   - submit it programmatically
4. Mark the injected send so the input interceptor does not treat it as fresh human input.
5. Record send success or failure back to Hermes backend.

Suggested prompt template:

```text
Tu es l'avatar vocal de Hermes.

Lis naturellement le message suivant a l'utilisateur comme si c'etait ta propre reponse.
Garde le sens principal.
Ne parle pas du fait que le message vient d'un autre systeme.

Message:
{{assistant_text}}
```

Acceptance criteria:

- Hermes output can be delivered back to the OshiKoi page
- Output injection does not loop back into `/api/oshikoi/input`
- The operator can diagnose output send failures

Suggested delegation prompt:

```text
Implement the OshiKoi output delivery path for Hermes Desktop. Create a prompt builder, queue outgoing assistant events in the backend, and make the companion extension inject and submit those prompts in the OshiKoi UI. Prevent the input interceptor from re-ingesting Hermes-originated output.
```

---

## Lot 6 - Operator controls in Hermes UI

Objective: expose bridge health and controls in the Hermes desktop app.

Files:

- Modify: `src/api.ts`
- Modify: `src/pages/CompanionsPage.tsx`

Tasks:

1. Add client methods for:
   - health
   - status
   - pending bridge state
   - manual test send
2. Add an operator panel showing:
   - companion extension detected or not
   - OshiKoi tab detected or not
   - ready for input
   - awaiting Hermes
   - last output delivery result
3. Add a manual test path for:
   - sending a sample assistant output
   - verifying the page bridge reacts
4. Add a bridge enable or disable toggle if useful.

Acceptance criteria:

- Operator can tell whether the bridge is alive
- Operator can test the output path from Hermes UI
- Important states are visible without opening devtools

Suggested delegation prompt:

```text
Expose the OshiKoi bidirectional bridge in Hermes Desktop UI. Update src/api.ts and src/pages/CompanionsPage.tsx to show bridge health, tab detection, readiness, and last output delivery result. Add a manual test-send action for the operator.
```

---

## Lot 7 - Verification and troubleshooting

Objective: make the bridge supportable and resilient.

Files:

- Add backend tests under `server/tests/`
- Add browser companion notes under `browser/oshikoi-companion/README.md`
- Create: `docs/troubleshooting-oshikoi-io-shell.md`

Tasks:

1. Add backend tests for:
   - envelope validation
   - anti-loop rules
   - queue behavior
   - bridge session state
2. Add at least lightweight frontend or extension sanity checks where practical.
3. Document common failures:
   - no OshiKoi tab
   - extension not loaded
   - page selectors changed
   - native submit not intercepted
   - Hermes answer ready but output not delivered
4. Add structured logs:
   - input captured
   - input forwarded
   - Hermes correlation created
   - output queued
   - output injected
   - output failed

Acceptance criteria:

- Targeted verification exists
- Troubleshooting doc exists
- Failures are diagnosable from logs and UI

Suggested delegation prompt:

```text
Add verification and troubleshooting support for the OshiKoi I/O shell bridge in Hermes Desktop. Cover envelope validation, anti-loop logic, queue behavior, and bridge session state with targeted backend tests. Add troubleshooting docs and structured logs so failures are diagnosable.
```

---

## Recommended execution order

1. Lot 0
2. Lot 1
3. Lot 2
4. Lot 3
5. Lot 4
6. Lot 5
7. Lot 6
8. Lot 7

## Suggested PR slicing

PR 1:

- Lot 0
- Lot 1

PR 2:

- Lot 2
- Lot 3

PR 3:

- Lot 4
- Lot 5

PR 4:

- Lot 6
- Lot 7

## Main risks

- Risk: OshiKoi DOM or flow changes break interception
  - Mitigation: isolate selectors and event hooks inside the companion extension
- Risk: duplicate responses if native submit is not fully prevented
  - Mitigation: treat input interception as a first-class acceptance gate
- Risk: output relay gets re-captured as input
  - Mitigation: explicit origin tagging and local suppression around programmatic submit
- Risk: local extension-to-backend communication is flaky
  - Mitigation: small, explicit health and status contracts plus retries where safe

## Deferred V2 items

- Better voice-input interception if OshiKoi bypasses the visible text compose path
- Exact playback injection into OshiKoi without using its own AI reply path
- Mate selection from Hermes
- Full transcript sync and richer state recovery
- Packaging and auto-install workflow for the companion extension

## Final instruction block to hand to `gpt-5.3-codex`

```text
Implement the OshiKoi integration as a bidirectional shell for Hermes Desktop.

Product model:
- user input happens in OshiKoi
- Hermes is the real intelligence layer
- Hermes output comes back through OshiKoi

Critical rules:
- do not fork the OshiKoi extension for MVP
- intercept human input before OshiKoi's normal backend chat path completes
- route human input into Hermes through the normal Hermes chat pipeline
- return Hermes output to OshiKoi through a relay prompt
- never let Hermes-originated output be re-ingested as user input
- keep all browser-specific logic in a Hermes-owned companion extension
- keep backend route handlers thin and service-oriented

Execution order:
1. architecture note
2. backend seam
3. companion extension scaffold
4. input interception
5. Hermes ingestion
6. output delivery
7. operator UI
8. verification and troubleshooting

For each lot:
- keep edits scoped
- preserve existing Hermes patterns
- add targeted verification where behavior changes
- report risks, files changed, and verification performed
```
