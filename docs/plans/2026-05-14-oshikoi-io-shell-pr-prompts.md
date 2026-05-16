# Hermes Desktop OshiKoi I/O Shell PR Prompts

Date: 2026-05-14
Repo: `C:\Users\GAMER PC\.hermes\hermes-builder`
Target execution model: `gpt-5.3-codex`
Primary source plan:

- `docs/plans/2026-05-14-oshikoi-io-shell-integration-plan.md`

## How to use this file

Run these prompts in order, one PR at a time.

Rules for every PR:

- stay inside the stated scope
- do not pre-implement later PRs
- preserve existing Hermes patterns
- keep route handlers thin and service-oriented
- report changed files, risks, and verification performed
- if a required seam is unclear, discover it in the repo first and document the choice in the final summary

Suggested execution order:

1. PR 1
2. PR 2
3. PR 3
4. PR 4

---

## PR 1 - Backend seam and architecture contract

Suggested PR title:

- `feat(oshikoi): add backend bridge seam and architecture contract`

Execution prompt:

```text
Work in this repo only:
C:\Users\GAMER PC\.hermes\hermes-builder

Context:
We are implementing a bidirectional OshiKoi shell for Hermes Desktop. OshiKoi is the user-facing input/output surface, and Hermes is the real intelligence layer. This PR is the first slice only: architecture note plus backend seam. Do not implement the browser companion extension yet.

Authoritative source plan:
docs/plans/2026-05-14-oshikoi-io-shell-integration-plan.md

Scope for this PR:
1. Lot 0 - Contract and state model
2. Lot 1 - Backend seam for OshiKoi bridge

Required outcomes:
- add a concise architecture note documenting the bidirectional bridge contract
- define the event envelope, allowed origins, bridge states, and anti-loop invariants
- create a clean backend seam under /api/oshikoi/*
- add thin route handlers and a service-owned state model
- expose these endpoints:
  - GET /api/oshikoi/health
  - GET /api/oshikoi/status
  - POST /api/oshikoi/input
  - POST /api/oshikoi/output
  - GET /api/oshikoi/events
- create stable JSON response contracts for these endpoints
- keep all browser-specific implementation out of this PR

Files expected to be created or modified:
- create docs/architecture/oshikoi-io-shell.md
- create server/services/oshikoi.mjs
- create server/routes/oshikoi.mjs
- modify server/index.mjs

Constraints:
- do not fork or patch the OshiKoi extension
- do not add fake browser automation in this PR
- keep route handlers thin
- put validation, normalization, and in-memory bridge state in the service
- default to ASCII in new files

Implementation guidance:
- use an in-memory MVP bridge session model
- define a stable event envelope with:
  - bridgeEventId
  - sessionId
  - roomId
  - origin
  - kind
  - text
  - createdAt
- define states:
  - disconnected
  - page_detected
  - ready_for_input
  - awaiting_hermes
  - injecting_output
  - error
- make error responses explicit and structured

Acceptance criteria:
- the new route mounts cleanly
- endpoint contracts are coherent and consistent
- architecture note is specific enough to guide later PRs
- service owns bridge state and route does not contain business logic

Verification:
- run targeted tests if added
- run the most relevant existing backend tests if practical
- if full test suite is too expensive, at least run the narrowest verification that exercises the new route/service seam

Final response requirements:
- summarize changed files
- explain the backend state model
- list verification performed
- call out any assumptions or seams that later PRs must respect
```

---

## PR 2 - Companion extension scaffold and input interception

Suggested PR title:

- `feat(oshikoi): add companion extension and intercept user input`

Execution prompt:

```text
Work in this repo only:
C:\Users\GAMER PC\.hermes\hermes-builder

Context:
We are implementing a Hermes-owned companion extension for oshikoi.io so OshiKoi can act as the input/output shell for Hermes. This PR covers the extension scaffold and the input interception path only.

Authoritative source plan:
docs/plans/2026-05-14-oshikoi-io-shell-integration-plan.md

Scope for this PR:
1. Lot 2 - Companion extension scaffold
2. Lot 3 - Input interception path

Required outcomes:
- create a local MV3 companion extension under browser/oshikoi-companion
- scope it to oshikoi.io and www.oshikoi.io
- add a content script that can detect page readiness and the chat compose surface
- connect the content script to Hermes Desktop backend on localhost
- intercept real human submit events before OshiKoi's normal backend chat path completes
- forward captured human text to POST /api/oshikoi/input
- prevent native OshiKoi submit for bridged turns
- handle duplicate submit and empty-text cases safely

Files expected to be created or modified:
- create browser/oshikoi-companion/manifest.json
- create browser/oshikoi-companion/content.js
- create browser/oshikoi-companion/README.md
- modify server/services/oshikoi.mjs only as needed for integration with the input path

Constraints:
- do not implement Hermes output delivery yet
- do not patch the OshiKoi extension
- do not rely on cookies or private session storage
- isolate selectors and event hooks inside the companion extension
- keep logic understandable and easy to retarget if oshikoi.io DOM shifts

Implementation guidance:
- add a clear distinction between human-originated events and programmatic events
- assign a bridgeEventId for each captured human turn
- make prevention of native submit explicit
- prefer a narrowly scoped DOM/event interception strategy over broad monkey-patching
- document unpacked install steps in the extension README

Acceptance criteria:
- extension loads on oshikoi.io
- human-authored input can be captured and sent to Hermes backend
- native OshiKoi submit is prevented for bridged turns
- duplicate submits are handled safely

Verification:
- validate manifest shape
- verify content script boot logic
- verify backend receives the forwarded input contract
- add the narrowest practical tests around backend input handling if behavior changed there

Final response requirements:
- summarize files created and modified
- explain the interception strategy
- list selectors or heuristics chosen and why
- describe failure modes still deferred to later PRs
```

---

## PR 3 - Hermes ingestion and output delivery

Suggested PR title:

- `feat(oshikoi): route bridged input through Hermes and deliver output back`

Execution prompt:

```text
Work in this repo only:
C:\Users\GAMER PC\.hermes\hermes-builder

Context:
This PR completes the bidirectional bridge core. Human input already originates in OshiKoi and is intercepted by the companion extension. Now we need to route that input through the real Hermes chat pipeline and deliver Hermes output back into OshiKoi without loops.

Authoritative source plan:
docs/plans/2026-05-14-oshikoi-io-shell-integration-plan.md

Scope for this PR:
1. Lot 4 - Hermes ingestion into normal chat pipeline
2. Lot 5 - Hermes output delivery back to OshiKoi

Required outcomes:
- identify and reuse the narrowest existing Hermes chat seam for a user turn
- route bridged OshiKoi human input into Hermes as a real user message
- attach source metadata like:
  - inputSource=oshikoi
  - origin=human
- store correlation data so the assistant answer can be matched back to the originating bridge event
- create a prompt builder for OshiKoi output relay
- queue outgoing Hermes assistant outputs in the backend
- expose pending output through the OshiKoi backend seam
- make the companion extension poll or subscribe for pending output
- inject Hermes-originated output into the OshiKoi compose surface and submit it programmatically
- prevent Hermes-originated output from being re-captured as fresh user input

Files expected to be created or modified:
- create server/services/oshikoi-prompt.mjs
- modify server/services/oshikoi.mjs
- modify browser/oshikoi-companion/content.js
- modify the Hermes backend or chat orchestration module that owns the normal chat input path

Constraints:
- do not invent a separate intelligence path outside normal Hermes chat orchestration
- keep output delivery best-effort and explicitly loop-safe
- do not make the main Hermes chat flow depend hard on OshiKoi output success
- keep browser-specific mechanics inside the companion extension

Prompt guidance:
- use a relaxed relay prompt, not strict verbatim mode
- tell OshiKoi to relay Hermes naturally without mentioning an upstream system

Acceptance criteria:
- a captured OshiKoi human turn can reach Hermes through the real chat path
- a resulting Hermes assistant answer can be delivered back into OshiKoi
- Hermes-originated output is not re-ingested as a new user input
- correlation between input and output events is explicit in backend state

Verification:
- test envelope validation and anti-loop behavior
- test queue behavior and correlation logic
- verify the backend can expose pending output events coherently
- add narrow tests where behavior changed

Final response requirements:
- summarize the ingestion seam chosen
- explain the anti-loop strategy in concrete terms
- list changed files and verification performed
- call out any edge cases still left for PR 4
```

---

## PR 4 - Operator UI, verification, and troubleshooting

Suggested PR title:

- `feat(oshikoi): add operator controls, tests, and troubleshooting`

Execution prompt:

```text
Work in this repo only:
C:\Users\GAMER PC\.hermes\hermes-builder

Context:
The OshiKoi bidirectional shell bridge exists. This PR makes it supportable: operator UI in Hermes Desktop, targeted verification, and troubleshooting docs.

Authoritative source plan:
docs/plans/2026-05-14-oshikoi-io-shell-integration-plan.md

Scope for this PR:
1. Lot 6 - Operator controls in Hermes UI
2. Lot 7 - Verification and troubleshooting

Required outcomes:
- expose OshiKoi bridge status in Hermes UI
- add client methods for health, status, pending bridge state, and manual test send
- update CompanionsPage to show:
  - companion extension detected or not
  - OshiKoi tab detected or not
  - ready for input
  - awaiting Hermes
  - last output delivery result
- add a manual test-send action for output delivery
- add targeted backend tests for:
  - envelope validation
  - anti-loop rules
  - queue behavior
  - bridge session state
- add troubleshooting docs for common failures
- add structured logs where needed so failures are diagnosable

Files expected to be created or modified:
- modify src/api.ts
- modify src/pages/CompanionsPage.tsx
- add or modify server/tests/*
- update browser/oshikoi-companion/README.md if needed
- create docs/troubleshooting-oshikoi-io-shell.md

Constraints:
- keep the UI compact and operator-focused
- preserve existing Hermes design patterns
- do not add unrelated product polish
- prefer clear states over decorative UI

Acceptance criteria:
- operator can tell whether the bridge is alive and usable
- operator can manually trigger an output test
- targeted verification exists for core bridge logic
- troubleshooting doc is actionable and specific

Verification:
- run the new or updated tests
- run the narrowest relevant frontend/backend checks for the modified surfaces
- report any remaining gaps honestly

Final response requirements:
- summarize UI changes
- summarize tests added or updated
- list verification performed
- identify any remaining operational risks after this PR
```

---

## Handoff prompt for a new Codex thread

Use this before pasting one of the PR prompts if you want to prime the thread:

```text
You are working in Hermes Desktop:
C:\Users\GAMER PC\.hermes\hermes-builder

Read these first for context:
- docs/plans/2026-05-14-oshikoi-io-shell-integration-plan.md
- docs/plans/2026-05-14-oshikoi-io-shell-pr-prompts.md

This is a scoped implementation task. Stay inside the PR prompt I give next. Do not pre-implement later PRs. Keep edits tight, preserve existing repo patterns, and report files changed, risks, and verification performed.
```
