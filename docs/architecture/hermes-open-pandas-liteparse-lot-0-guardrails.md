# Hermes + Open_Pandas_AI + LiteParse - Lot 0 Guardrails

Date: 2026-05-29  
Repo: `C:\Users\GAMER PC\.hermes\hermes-builder`

## 1. Goal

Freeze responsibilities and boundaries before implementation lots start.

Lot 0 must lock:
- Hermes Desktop as orchestrator and product shell
- Open_Pandas_AI as the data-analyst execution engine
- LiteParse as reusable document ingestion/parsing layer
- Open_Pandas_AI invocation strategy: local CLI/API first, local HTTP service only when needed

## 2. Architecture Decision Summary

### Decision D1 - Control Plane

Hermes Desktop is the single control plane:
- user entry point
- chat/agent teams orchestration
- runtime routing
- state and session coordination

Hermes must not embed Streamlit UI code from Open_Pandas_AI.

### Decision D2 - Data Analyst Runtime

Open_Pandas_AI remains an independent runtime:
- pandas/polars/DuckDB analysis pipeline
- Python code execution sandbox
- analysis result generation

Hermes must call Open_Pandas_AI through a stable boundary (CLI/API contract), not by importing app internals into Hermes frontend/backend.

### Decision D3 - Document Ingestion Layer

LiteParse is treated as a reusable parsing component:
- document-to-text extraction
- page metadata and coordinates
- OCR integration (local or HTTP OCR backend)
- screenshots/previews when required

LiteParse is not a standalone product runtime in this architecture.

### Decision D4 - Invocation Path

Open_Pandas_AI invocation phases:
1. Phase A (default): local CLI or local process API contract managed by Hermes backend.
2. Phase B (optional): promote to local HTTP service only if concurrency/operability requires it.

No direct Hermes frontend to Open_Pandas_AI calls; Hermes backend is the only gateway.

## 3. Responsibility Matrix

| Domain | Hermes Desktop | Open_Pandas_AI | LiteParse |
| --- | --- | --- | --- |
| UX / Product shell | Owns | Consumes via integration | N/A |
| Agent orchestration | Owns | Tool target | Tool target |
| DataFrame analysis | Delegates | Owns | N/A |
| Python sandbox execution | N/A | Owns | N/A |
| Document parsing/OCR routing | Owns integration surface | May consume for RAG | Owns parsing capability |
| Session/memory metadata | Owns | Emits analysis outputs | Emits parse outputs |
| File ingestion policy | Owns boundary policy | Consumes normalized inputs | Provides extracted content |

## 4. Hard Boundaries (Non-Negotiable)

1. No Streamlit code from Open_Pandas_AI is copied into Hermes frontend.
2. Hermes does not reimplement Open_Pandas_AI pipeline logic.
3. Hermes does not add pandas runtime logic in Node to mimic Open_Pandas_AI.
4. LiteParse remains reusable and can be consumed by Hermes and Open_Pandas_AI without forking responsibilities.
5. Any OCR server is optional infra behind LiteParse, not a replacement architecture.

## 5. Integration Contracts (Lot 0 Freeze)

### 5.1 Hermes -> Open_Pandas_AI contract

Required request envelope:
- `question`
- `dataset_path` or serialized dataset handle
- runtime options (`provider`, `model`, safety/timeouts, workspace id)

Required response envelope (JSON serializable):
- `status` (`ok`/`error`)
- `summary`
- `result_preview` (table/scalar-safe preview)
- `generated_code`
- `metrics`
- `artifacts` (charts/files references when present)
- `error` (normalized error object when failed)

### 5.2 Hermes -> LiteParse contract

Required request envelope:
- input source (path/bytes)
- parse options (OCR on/off, language, pages, output format)

Required response envelope:
- extracted text by page
- bounding boxes/coordinates when available
- parse metadata (pages, dimensions, timing)
- warnings/errors normalized

### 5.3 Open_Pandas_AI internal use of LiteParse

Allowed:
- ingesting PDF/doc content for workspace/RAG context

Not assumed in Lot 0:
- fully automatic high-confidence PDF table-to-DataFrame conversion for all files

## 6. Backlog for Lot 0 (Architecture Freeze)

### L0.1 - Boundary ADR and Decision Record

Deliverables:
- this guardrails document accepted as canonical Lot 0 contract
- decision IDs (`D1`..`D4`) referenced in later lot docs

Definition of done:
- architecture review sign-off
- no conflicting ownership statements in current docs

### L0.2 - Interface Contract Drafts

Deliverables:
- Hermes/Open_Pandas_AI request-response schema draft
- Hermes/LiteParse parse schema draft

Definition of done:
- schemas reviewed by both Hermes and Open_Pandas_AI maintainers
- explicit error model documented

### L0.3 - Deployment Mode Decision

Deliverables:
- phase policy documented: `CLI/API local first`, `HTTP service later if needed`
- trigger conditions for HTTP promotion defined (throughput, concurrency, observability)

Definition of done:
- policy accepted
- no premature HTTP-only dependency introduced

### L0.4 - Anti-Coupling Checklist

Deliverables:
- check list applied before each PR in lots 1-3

Checklist:
- no Streamlit imports added inside Hermes code
- no pandas analysis engine duplicated in Hermes backend
- LiteParse integration remains library-level and reusable

Definition of done:
- checklist referenced in PR template or lot execution notes

## 7. Success Criteria (Lot 0 Exit)

Lot 0 is complete only if all are true:
1. Hermes is explicitly defined as orchestrator.
2. Open_Pandas_AI is explicitly defined as data analyst engine.
3. LiteParse is explicitly defined as reusable ingestion/parsing layer.
4. Invocation strategy is frozen as local CLI/API first, HTTP second.
5. No planned work item violates anti-coupling boundaries.

## 8. Risks and Mitigations

Risk: hidden coupling through convenience imports.  
Mitigation: enforce service boundary and schema contract reviews.

Risk: forcing HTTP service too early increases operational complexity.  
Mitigation: keep local process mode as default until measured need.

Risk: overpromising document-to-table extraction quality.  
Mitigation: scope LiteParse value to parsing/context first; table extraction as later validated lot.

