# Hermes Desktop Architecture Remediation Plan

Goal: align implementation with the audit findings while minimizing regression risk.

Architecture: incremental refactor (strangler style), preserve API compatibility, verify each step with targeted tests.

Tech stack: Node/Express (server), React/TypeScript (frontend), Electron, Node test runner.

---

## Baseline and non-regression criteria

- [ ] Run backend test suite before changes.
- [ ] Define critical smoke checks:
  1) `/api/gateway/health`
  2) chat stream endpoint still returns SSE chunks
  3) session list/load endpoints
  4) voice synth endpoint response contract
  5) kanban board/task endpoints

Commands:
- `npm test` (project root)
- `node --test server/tests/voice.test.mjs`

---

## Phase 1 — Kanban route/service consistency (HIGH)

Objective: enforce routes -> services pattern.

Files:
- Create: `server/services/kanban.mjs`
- Modify: `server/routes/kanban.mjs`

Tasks:
1. Move hermes CLI kanban execution logic out of route into service.
2. Expose service functions for board/task operations.
3. Keep route as thin adapter: validate input, call service, map HTTP status/errors.
4. Reuse common error serializer in service (`sendKanbanError`).

Verification:
- Route imports only service and no low-level WSL command code.
- `npm test` passes.

---

## Phase 2 — useChat decomposition (MEDIUM, safe-first)

Objective: reduce `useChat.ts` monolith without API break.

Files:
- Create: `src/hooks/chatProviderRuntime.ts`
- Modify: `src/hooks/useChat.ts`

Tasks:
1. Extract provider/runtime detection helpers (`getRuntimeProviderKey/Label`) to dedicated module.
2. Keep `useChat` public API unchanged.
3. Confirm no behavior changes by running existing tests/lint where possible.

Verification:
- `useChat.ts` shrinks and imports provider runtime helpers.
- Build remains behavior-compatible for provider label/key derivation.

Follow-up (next iteration):
- Extract voice capture/playback controller.
- Extract attachment/ref parser.
- Extract slash-command executor.

---

## Phase 3 — Voice/Kokoro responsibility contract (MEDIUM)

Objective: remove ambiguity between orchestration and text-shaping layers.

Files:
- Create: `docs/architecture/voice-kokoro-boundary.md`

Tasks:
1. Document role split (`voice.mjs` vs `kokoro-tts.mjs`).
2. Document data contracts in/out for synthesis planner and API response.
3. Add clear ownership rule for future changes.

Verification:
- Doc exists and is specific enough to guide contributors.

---

## Execution order

1) Phase 1 (Kanban service extraction)
2) Phase 2 (safe-first useChat extraction)
3) Phase 3 (boundary doc)
4) Run tests and collect results

---

## Definition of Done

- Kanban logic isolated in service layer.
- useChat has first extracted submodule with no API break.
- Voice/Kokoro boundary documented.
- Targeted tests executed and reported.
