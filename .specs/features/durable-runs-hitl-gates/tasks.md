# Durable Runs + Multi-Stage HITL Gates Tasks

**Design**: `.specs/features/durable-runs-hitl-gates/design.md`
**Testing**: `.specs/codebase/TESTING.md`
**Status**: Draft

---

## Execution Plan

### Phase 1: Foundation (Parallel, then one join)

```
T1 [P] ─┐
T2 [P] ─┤
T3 [P] ─┼──────────────────┐
T4 [P] ─┤                  │
T5 [P] ─┤                  │
T6 [P] ─┴──→ T7             │  (T7 needs T6)
```

### Phase 2/3/4: Three parallel tracks after Foundation

```
ai-api track (mostly sequential — shared subsystem):
  T5,T6 ──┬──→ T8 ──┐
  T5 ─────┼──→ T9 ──┼──→ T11 ──→ T12 ──→ T13 ──→ T14 ──→ T15
  T5 ─────┴──→ T10 ─┘            (T3→T13)

Nest track (needs T7 contract + T4 migration):
  T7 ──┬──→ T16 ──┐
  T7 ──┼──→ T17 ──┤
  T4 ──┴──→ T18 ──┼──→ T19 ──→ T20 ──┬──→ T21 ──┐
                                       └──→ T22 ──┼──→ T23 (also needs T14)
                                                   ┘

Frontend track (needs T7 contract only — builds against agreed types):
  T7 ──→ T24 ──┬──→ T25 ──→ T26 ──┐
                ├──→ T27 [P]       │
                ├──→ T28 ──→ T29 ──┤──→ T31
                └──→ T30 [P] ──────┘
```

Nest track and Frontend track can run concurrently with each other and with the ai-api track — they only share the Phase 1 contract (T7) and, for Nest, the migration (T4). `T23` (Nest e2e) is the one cross-track join: it needs the Nest service/controller work **and** a functioning ai-api `/agent/resume` (T14).

---

## Task Breakdown

### T1: Add Redis Stack service to docker-compose [P]

**What**: Add a `redis` service (`redis/redis-stack-server` image) to `docker-compose.yml`, with `appendonly yes` + `maxmemory-policy noeviction` and a healthcheck.
**Where**: `docker-compose.yml`
**Depends on**: None
**Reuses**: Existing `postgres` service block as the pattern (healthcheck shape, `restart: unless-stopped`)
**Requirement**: HITL-06

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] `redis` service present with `redis/redis-stack-server:latest`, durability args set (verify exact env var name against the image's current docs first — flagged uncertain in design.md)
- [ ] Healthcheck via `redis-cli ping`
- [ ] `docker compose config --quiet` passes (valid syntax)
- [ ] `docker compose up -d redis && redis-cli -h localhost MODULE LIST` shows `ReJSON` and `search`

**Tests**: none
**Gate**: build (`docker compose config --quiet`)

---

### T2: Register `integration` pytest marker + add Redis checkpoint dependency [P]

**What**: Add `langgraph-checkpoint-redis` to `apps/ai-api/requirements.txt`; register `markers = integration: requires real Redis` in `pytest.ini`.
**Where**: `apps/ai-api/requirements.txt`, `apps/ai-api/pytest.ini`
**Depends on**: None
**Reuses**: Existing `pytest.ini` structure
**Requirement**: HITL-06

**Tools**: MCP: `context7` (confirm current package version) · Skill: NONE

**Done when**:
- [ ] `pip install -r requirements.txt` succeeds
- [ ] `pytest --markers` lists `integration`
- [ ] Existing suite still green: `pytest -m "not integration"` — same pass count as before this change

**Tests**: none
**Gate**: quick (`cd apps/ai-api && pytest -m "not integration"`)

---

### T3: Add `REDIS_URL` setting [P]

**What**: Add `REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")` to settings.
**Where**: `apps/ai-api/app/config/settings.py`
**Depends on**: None
**Reuses**: Existing flat-constants style already in the file
**Requirement**: HITL-06

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] `REDIS_URL` importable from `app.config.settings`
- [ ] No import errors: `python -c "from app.config.settings import REDIS_URL"`

**Tests**: none
**Gate**: quick

---

### T4: Migration — new `analyses` columns [P]

**What**: TypeORM migration adding `approval_stage varchar nullable`, `publish_policy jsonb`, `prd_iterations jsonb default '[]'`, `spec_iterations jsonb default '[]'`, `resumed_count int default 0`.
**Where**: `apps/backend/src/shared/database/postgres/migrations/<timestamp>-AddHitlApprovalColumns.ts`
**Depends on**: None
**Reuses**: `1786300000000-CreateAnalysesTable.ts` as the structural pattern (same `up`/`down` style)
**Requirement**: HITL-02, HITL-03, HITL-04, HITL-05

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] `npm run migration:run` succeeds against local Postgres (`docker compose up -d postgres` first)
- [ ] `npm run migration:revert` cleanly drops the new columns
- [ ] Column defaults verified via `\d analyses` in psql

**Tests**: none
**Gate**: build (migration up/down round-trip)

---

### T5: Update `GraphState` [P]

**What**: Remove `api_keys` from `GraphState`; add `revision_notes: list[dict] | None`, `prd_iteration: int`, `spec_iteration: int`.
**Where**: `apps/ai-api/app/graph/state.py`
**Depends on**: None
**Reuses**: Existing `TypedDict` shape
**Requirement**: HITL-01

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] `api_keys` no longer a `GraphState` key
- [ ] New fields present with correct types
- [ ] Any existing test referencing `state["api_keys"]` updated (check `tests/test_agent_run.py`) — same or higher pass count than before

**Tests**: unit
**Gate**: quick

---

### T6: Update ai-api Pydantic schemas [P]

**What**: Add `Policies`, `Annotation`, `ApprovalDecision`, `AgentResumeRequest`; add `analysisId: str` and `policies: Policies` to `AgentRunRequest`; add `"awaiting_approval"` to `AgentEventType`.
**Where**: `apps/ai-api/app/application/dto/schemas.py`
**Depends on**: None
**Reuses**: Existing `BaseModel` patterns in the same file
**Requirement**: HITL-02, HITL-03, HITL-04

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] All new models defined exactly per design.md's schema block
- [ ] `AgentRunRequest(**valid_payload)` round-trips
- [ ] `ApprovalDecision(action="reject", annotations=None)` — decide and assert whether Pydantic-level or Nest-level is where this gets rejected (design puts it at Nest's DTO layer — this task's model just needs `annotations` to be optional at the schema level, not enforce it)

**Tests**: unit (pydantic validation)
**Gate**: quick

---

### T7: Mirror contract in Nest shared types

**What**: Add matching TypeScript types — `Policies`, `Annotation`, `ApprovalDecision`, `AgentResumeRequest`, `AgentRunRequest` +`analysisId`/`policies`, `AgentEventType` +`'awaiting_approval'`.
**Where**: `apps/backend/src/shared/types` (mirrors `apps/ai-api/app/application/dto/schemas.py`)
**Depends on**: T6
**Reuses**: Existing `AgentRunRequest`/`AgentEvent` type file structure
**Requirement**: HITL-02, HITL-03, HITL-04

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Field names/shapes match T6's Python schemas exactly (cross-check side by side)
- [ ] `tsc -b` clean in `apps/backend`

**Tests**: none
**Gate**: build

---

### T8: `human_approval` node factory

**What**: New `make_approval_node(stage)` factory per design.md's sketch — reads policy from `config["configurable"]["policies"][stage]`, calls `interrupt()` when `manual`, routes on `decision["action"]`.
**Where**: `apps/ai-api/app/graph/nodes/human_approval.py` (new)
**Depends on**: T5, T6
**Reuses**: `langgraph.types.interrupt`
**Requirement**: HITL-02, HITL-03

**Tools**: MCP: `context7` (re-verify `interrupt`/`RunnableConfig` signature if any doubt while coding) · Skill: NONE

**Done when**:
- [ ] `policy == "auto"` path returns approve decision **without** calling `interrupt()` (assert via a test double that raises if `interrupt` is invoked)
- [ ] `policy == "manual"` path calls `interrupt()` with `{stage, iteration}`
- [ ] Resume with `action="reject"` sets `revision_notes` to the submitted annotations
- [ ] Resume with `action="approve"` clears `revision_notes`
- [ ] Test built on `langgraph.checkpoint.memory.InMemorySaver` (no real Redis needed for this unit test) — N=4+ tests pass

**Tests**: unit
**Gate**: quick

---

### T9: `prd_node` revision branch [P]

**What**: When `state.get("revision_notes")` is set, build the prompt as a revision (prior PRD + notes) instead of from-scratch.
**Where**: `apps/ai-api/app/graph/agents/prd.py`
**Depends on**: T5
**Reuses**: Existing prompt-building function in the same file
**Requirement**: HITL-04

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Fresh-generation path unchanged (no `revision_notes` → same prompt as today)
- [ ] Revision path includes prior `state["prd"]` content and each annotation's `excerpt`/`note` in the prompt
- [ ] `tests/test_prd.py` extended with a revision-notes case, all cases green

**Tests**: unit
**Gate**: quick

---

### T10: `implementation_spec_node` revision branch [P]

**What**: Same as T9, for the SPEC node.
**Where**: `apps/ai-api/app/graph/agents/implementation_spec.py`
**Depends on**: T5
**Reuses**: Same pattern as T9 (apply identically)
**Requirement**: HITL-04

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Same criteria as T9, scoped to the SPEC node
- [ ] Relevant existing test file extended, all cases green

**Tests**: unit
**Gate**: quick

---

### T11: Wire approval nodes into the graph

**What**: Add `prd_approval`/`spec_approval` nodes; conditional edges (`approve`→forward, `reject`→loop back to `prd`/`implementation_spec`); `build_graph(checkpointer)` takes the checkpointer as a parameter instead of being called at module import.
**Where**: `apps/ai-api/app/graph/graph.py`
**Depends on**: T8, T9, T10
**Reuses**: Existing `StateGraph`/`add_edge` calls in the same file
**Requirement**: HITL-02, HITL-03, HITL-04

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] `build_graph` signature is `build_graph(checkpointer)`
- [ ] Graph structure test: `prd → prd_approval → {implementation_spec | prd}`, `implementation_spec → spec_approval → {test_reviewer & architecture_reviewer | implementation_spec}`
- [ ] Compiles without error against `InMemorySaver`

**Tests**: unit
**Gate**: quick

---

### T12: Split `pipeline.py` into run/resume

**What**: `run_pipeline(graph, request)` and `resume_pipeline(graph, analysis_id, api_keys, models, policies, decision)`; move `api_keys`/`policies` into `configurable` (never into the initial state dict); detect the interrupt marker from `astream(..., stream_mode="updates")` and emit `AgentEvent(type="awaiting_approval", ...)`, ending the generator there.
**Where**: `apps/ai-api/app/graph/pipeline.py`
**Depends on**: T11, T6
**Reuses**: `EVENT_BY_NODE`, `start_run`/`end_run` from `thoughts.py`
**Requirement**: HITL-01, HITL-02, HITL-03

**Tools**: MCP: `context7` (resolve the Open Item #1 uncertainty — exact interrupt-chunk shape under `stream_mode="updates"` — with a scratch script against `InMemorySaver` before writing the dispatch logic) · Skill: NONE

**Done when**:
- [ ] `api_keys` never appears as a key in the dict passed as `astream`'s `input` (only in `config["configurable"]`)
- [ ] A manual-policy run against `InMemorySaver` yields `awaiting_approval` after `prd_generated` and stops (no `spec_generated` in the same leg)
- [ ] `resume_pipeline` with `decision=None` continues a non-interrupted, non-crashed run to completion unchanged (regression check)
- [ ] `resume_pipeline` with a reject `decision` re-enters `prd`, yields a second `prd_generated`, then `awaiting_approval` again

**Tests**: unit
**Gate**: quick

---

### T13: FastAPI lifespan — checkpointer + graph lifecycle

**What**: `AsyncRedisSaver` entered via `AsyncExitStack` in a lifespan function; `app.state.graph = build_graph(saver)`.
**Where**: `apps/ai-api/app/main.py`
**Depends on**: T12, T3
**Reuses**: Design.md's lifespan sketch verbatim as the starting point
**Requirement**: HITL-06

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] App boots against a real local Redis Stack (`docker compose up -d redis` first): `uvicorn app.main:app` starts without error
- [ ] `app.state.graph` is set before the first request is served
- [ ] Killing Redis before boot → app fails to start loudly (per design's error-handling table, no silent fallback)

**Tests**: none (exercised functionally by T14/T15)
**Gate**: quick (TestClient boot smoke test)

---

### T14: `/agent/run` + new `/agent/resume` routes

**What**: `/agent/run` reads `request.app.state.graph` instead of a module-level graph; new `POST /agent/resume` streams via `resume_pipeline`.
**Where**: `apps/ai-api/app/api/routes/agent.py`
**Depends on**: T13, T12
**Reuses**: Existing `_sse` generator wrapper
**Requirement**: HITL-01, HITL-02, HITL-03

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] `POST /agent/run` behavior unchanged for the existing (non-HITL) event types — no regression in `tests/test_agent_run.py`
- [ ] `POST /agent/resume` accepts `AgentResumeRequest`, streams `AgentEvent`s, same SSE header shape as `/agent/run`
- [ ] TestClient integration test (in-process, `InMemorySaver`) drives a full run through one reject + one approve cycle at `prd`, ending at `spec_generated`

**Tests**: unit
**Gate**: quick

---

### T15: Integration test — real Redis durability

**What**: Kill-and-resume test against a real Redis Stack container: run to `prd_generated`, kill the process holding the graph (simulate by discarding the in-process app and rebuilding it against the same Redis), resume, assert the `prd` node did not re-run (call-count or usage comparison) and the run reaches `awaiting_approval`. Separate test: serialize a checkpoint and assert no `api_keys`/API-key substring is present.
**Where**: `apps/ai-api/tests/test_durability_integration.py` (new), marked `@pytest.mark.integration`
**Depends on**: T14
**Reuses**: `tests/llm_fakes.py` for the LLM double (keep the integration test about durability, not live LLM calls)
**Requirement**: HITL-01 (spec Success Criteria: "matar container e retomar sem perder PRD/Spec")

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] `pytest -m integration` (with `docker compose up -d redis` first) — both tests pass
- [ ] Node re-execution count after resume matches "not reprocessed" expectation exactly (assert the count, not just "test passed")
- [ ] `api_keys` absence assertion covers the full serialized checkpoint blob, not just top-level keys

**Tests**: integration
**Gate**: full

---

### T16: `AiApiClient.resumeAgent()`

**What**: New method mirroring `runAgent`, POSTs to `/agent/resume`.
**Where**: `apps/backend/src/shared/clients/ai/ai-api.client.ts`
**Depends on**: T7
**Reuses**: `parseEvent` (shared with `runAgent`)
**Requirement**: HITL-01

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Same error handling as `runAgent` (non-ok response throws)
- [ ] Unit test with a mocked `fetch` SSE body — N=2+ tests pass, matches `ai-api.client.spec.ts` existing style

**Tests**: unit
**Gate**: quick

---

### T17: `ApproveAnalysisDto` + `ResumeAnalysisDto`

**What**: class-validator DTOs. `ApproveAnalysisDto`: `stage`, `decision`, `annotations?`, `apiKeys?`, `models?` — with a custom validator rejecting `decision:'reject'` + empty/missing `annotations` when `stage` is `prd`/`spec`. `ResumeAnalysisDto`: `apiKeys`, `models`.
**Where**: `apps/backend/src/modules/analyses/dtos/approve-analysis.dto.ts`, `.../resume-analysis.dto.ts` (new)
**Depends on**: T7
**Reuses**: `RunAnalysisDto`'s `ReviewModelsDto`/`ApiKeysDto` (import, don't redefine)
**Requirement**: HITL-04

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] `class-validator` rejects `{stage:'prd', decision:'reject', annotations:[]}` (spec HITL-04 criterion 3)
- [ ] Accepts `{stage:'publish', decision:'approve'}` with no `annotations` required
- [ ] Unit tests: N=4+ cases (valid prd reject, invalid empty-annotation reject, valid publish approve, valid publish reject) all pass

**Tests**: unit
**Gate**: quick

---

### T18: Entity + types update

**What**: Add new columns to `Analysis` entity; extend `AnalysisStatus`, add `approvalStage`, `PublishPolicy`, `Annotation`, iteration array types to `analyses.types.ts`.
**Where**: `apps/backend/src/modules/analyses/analysis.entity.ts`, `apps/backend/src/modules/analyses/analyses.types.ts`
**Depends on**: T4
**Reuses**: Existing `@Column` patterns in the same entity
**Requirement**: HITL-02, HITL-03, HITL-05

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Entity columns match the migration from T4 exactly (name, type, nullability)
- [ ] `toRecord()` (in `analyses.service.ts`) will need these fields later — not this task's job, just confirm types compile: `tsc -b` clean

**Tests**: none
**Gate**: build

---

### T19: `buildAgentRunRequest` — analysisId + policies

**What**: Include `analysisId` (the just-created `analysis.id`) and `policies` (from the run DTO) in the payload sent to ai-api.
**Where**: `apps/backend/src/modules/analyses/helpers/context-builder.helper.ts`
**Depends on**: T7, T18
**Reuses**: Existing function signature, extend its params
**Requirement**: HITL-01

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] `RunAnalysisDto` gains a `policies: PublishPolicyDto` field (nested, mirrors `ReviewModelsDto` validation style)
- [ ] Unit test: payload built includes `analysisId` equal to the passed-in id and the DTO's policies verbatim

**Tests**: unit
**Gate**: quick

---

### T20: Extract `streamLeg` + gate publish

**What**: Pull the streaming-proxy body out of `AnalysesService.run()` into `private streamLeg(analysis, events, res)`. Add `awaiting_approval` handling (persist status+stage, write event, return). Gate `report_ready`'s auto-publish behind `publishPolicy.publish` — `manual`/failed-`auto_safe` → set `awaiting_approval`/`approval_stage:'publish'` and return without publishing; `auto`/passing-`auto_safe` → publish exactly as today.
**Where**: `apps/backend/src/modules/analyses/analyses.service.ts`
**Depends on**: T16, T18, T19
**Reuses**: The existing loop body verbatim as the extraction source (`analyses.service.ts:104-202`)
**Requirement**: HITL-02, HITL-03, HITL-05

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] `run()` now calls `streamLeg` and produces byte-identical SSE output to before, for the non-HITL happy path (regression)
- [ ] `manual` publish policy: `publishGithubComments` is **not** called after `report_ready`; status becomes `awaiting_approval`/`publish`
- [ ] `auto` publish policy: unchanged behavior (publishes immediately), matches pre-existing e2e expectations
- [ ] Unit tests with a mocked `aiApiClient` event sequence — N=5+ cases (prd/spec awaiting_approval, manual publish gate, auto publish passthrough, error passthrough)

**Tests**: unit
**Gate**: quick

---

### T21: `resume()` service method + controller route

**What**: `AnalysesService.resume(analysisId, currentUser, {apiKeys, models}, req, res)` — loads analysis (must belong to user, status `running`/`error`), calls `aiApiClient.resumeAgent` with `decision: null`, delegates to `streamLeg`. Controller: `POST /analyses/:id/resume`.
**Where**: `apps/backend/src/modules/analyses/analyses.service.ts` (add method), `apps/backend/src/modules/analyses/analyses.controller.ts` (add route)
**Depends on**: T20
**Reuses**: `streamLeg` from T20, `getByIdForUser`'s ownership-check pattern
**Requirement**: HITL-01

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] 404 if analysis doesn't belong to `currentUser`
- [ ] 409 if status is not `running`/`error`
- [ ] `resumedCount` incremented on each call
- [ ] Unit tests: N=3+ cases (happy path, wrong owner, wrong status)

**Tests**: unit
**Gate**: quick

---

### T22: `approve()` service method + controller route

**What**: `AnalysesService.approve(analysisId, currentUser, dto: ApproveAnalysisDto, req, res)`. Branches on `dto.stage`:
- `publish`: no ai-api call. `approve` → call `publishGithubComments` directly, persist `completed`, return plain JSON. `reject` → persist `error` (irreversible per spec rule 5 — no revision loop for publish).
- `prd`/`spec`: validate each `annotation.excerpt` is a substring of the analysis's current `prd`/`spec` content (400 if not — stale-selection edge case from spec); on `reject`, push `{content: currentValue, annotations, createdAt}` into `prdIterations`/`specIterations` *before* calling ai-api; call `aiApiClient.resumeAgent` with the decision; delegate to `streamLeg`.

Controller: `POST /analyses/:id/approve`.
**Where**: `apps/backend/src/modules/analyses/analyses.service.ts` (add method), `apps/backend/src/modules/analyses/analyses.controller.ts` (add route)
**Depends on**: T20, T17
**Reuses**: `streamLeg` from T20, `publishGithubComments` (unchanged, just called from a new call site)
**Requirement**: HITL-02, HITL-03, HITL-04, HITL-05

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] `stage:'publish', decision:'approve'` → `publishGithubComments` called once, status `completed`
- [ ] `stage:'publish', decision:'reject'` → status `error`, no GitHub call
- [ ] `stage:'prd', decision:'reject', annotations:[{excerpt not in current prd}]` → 400, no ai-api call
- [ ] `stage:'prd', decision:'reject', annotations:[valid]` → `prdIterations` gains one entry, ai-api resume called with the decision
- [ ] Unit tests: N=6+ cases covering all branches above

**Tests**: unit
**Gate**: quick

---

### T23: Nest e2e — full multi-stage flow

**What**: End-to-end test (real Postgres, real ai-api process) driving: run with all-`manual` policies → reject `prd` with an annotation → confirm `prdIterations.length === 1` and a second `prd_generated` arrives → approve `prd` → same reject/approve cycle at `spec` → `report_ready` → `awaiting_approval`/`publish` → approve `publish` → `completed` with `githubComments` set. Also: zero GitHub write occurs before the final publish-approve call (spec Success Criteria).
**Where**: `apps/backend/test/analyses-hitl.e2e-spec.ts` (new)
**Depends on**: T21, T22, T14
**Reuses**: Existing e2e bootstrap/fixtures (whatever `jest-e2e.json` config + test app factory the current e2e suite uses)
**Requirement**: HITL-02, HITL-03, HITL-04, HITL-05 (spec Success Criteria: "run com 3 stages manual produz 3 awaiting_approval distintos", "zero comentários publicados sem aprovação")

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Full flow above passes as a single test (or a tightly-ordered sequence of tests sharing one analysis id)
- [ ] GitHub-write assertion: mock/spy on the GitHub-calling layer, assert zero calls until the publish-approve step
- [ ] `docker compose up -d postgres redis && npm run test:e2e` — this spec's cases all pass, existing e2e suite pass count unchanged elsewhere

**Tests**: e2e
**Gate**: full

---

### T24: Frontend types

**What**: Extend `AnalysisStatus` +`'awaiting_approval'`, `AgentEventType` +`'awaiting_approval'`, add `Policies`, `Annotation`, `ApprovalDecision`, `PublishPolicy`; extend `RunAnalysisPayload` with `policies`.
**Where**: `apps/frontend/src/types` (mirrors the Nest/ai-api contract from T7)
**Depends on**: T7
**Reuses**: Existing type file structure
**Requirement**: HITL-02, HITL-03, HITL-04, HITL-05

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Types match T7's Nest types field-for-field
- [ ] `tsc -b` clean

**Tests**: none
**Gate**: build

---

### T25: `analyses.api.ts` — resume + approve calls

**What**: `resume(id, payload, signal): AsyncGenerator<AgentEvent>` (POST `/analyses/:id/resume`), `approveStage(id, payload, signal): AsyncGenerator<AgentEvent>` (POST `/analyses/:id/approve` for `prd`/`spec`), `approvePublish(id, payload): Promise<AnalysisRecord>` (POST `/analyses/:id/approve` for `publish`, plain JSON response).
**Where**: `apps/frontend/src/api/analyses.api.ts`
**Depends on**: T24
**Reuses**: `parseSseChunk`, the existing `run()` method's fetch/stream-reading structure
**Requirement**: HITL-01, HITL-02, HITL-03, HITL-05

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] `resume`/`approveStage` reuse the identical SSE-parsing loop as `run` (extract a shared helper rather than copy-pasting three times)
- [ ] `approvePublish` uses the plain `request()` helper (JSON, not streaming)
- [ ] `tsc -b` clean

**Tests**: none
**Gate**: build

---

### T26: `useAnalysisRun` — awaiting_approval phase + actions

**What**: Extract the shared SSE-event-processing block (currently inline in `start`'s `for await`) into a reusable function; add `phase: 'awaiting_approval'`, track `awaitingStage`/`iteration`; add `resume()`, `approveStage()`, `approvePublish()` actions that reuse the extracted event-processing function.
**Where**: `apps/frontend/src/hooks/useAnalysisRun.ts`
**Depends on**: T25
**Reuses**: The existing `start` implementation as the extraction source
**Requirement**: HITL-01, HITL-02, HITL-03, HITL-04, HITL-05

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] `start`'s existing behavior unchanged (regression — same phases/events for a non-HITL run)
- [ ] `awaiting_approval` event sets `phase:'awaiting_approval'` and stops the loop (stream naturally ends, per T14's server-side behavior)
- [ ] `resume`/`approveStage`/`approveStage`-after-reject all continue accumulating into the same `events`/`thoughts` state rather than resetting it
- [ ] `tsc -b` clean

**Tests**: none
**Gate**: build

---

### T27: Status badge + stepper — awaiting_approval [P]

**What**: Add `awaiting_approval` label/color to `AnalysisStatusBadge`; add a paused/waiting visual state to `AgentStepper` for the current stage.
**Where**: `apps/frontend/src/components/analysis/AnalysisStatusBadge.tsx`, `apps/frontend/src/components/analysis/AgentStepper.tsx`
**Depends on**: T24
**Reuses**: Existing `labels`/`styles` record pattern in `AnalysisStatusBadge`
**Requirement**: HITL-02, HITL-03, HITL-05

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] `awaiting_approval` renders distinctly from `running`/`completed`/`error`
- [ ] `tsc -b` + `oxlint` clean

**Tests**: none
**Gate**: build

---

### T28: `ExcerptCommentEditor` component

**What**: New component — given rendered markdown content, lets the user select a passage and attach a note; accumulates an `Annotation[]` in local state; exposes it to the parent.
**Where**: `apps/frontend/src/components/analysis/ExcerptCommentEditor.tsx` (new)
**Depends on**: T24
**Reuses**: Existing `ReportView`'s markdown rendering approach, if any is reusable; otherwise `components/ui` primitives (`Button`, `Field`)
**Requirement**: HITL-04

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Text selection produces an `excerpt` matching the selected substring exactly (must line up with the backend's substring-match validation from T22)
- [ ] Each annotation shows `{excerpt, note}` in a removable list before submit
- [ ] `tsc -b` + `oxlint` clean

**Tests**: none
**Gate**: build

---

### T29: `ApprovalGate` component

**What**: Renders the current stage's content (`prd`/`spec`/`publish` preview), embeds `ExcerptCommentEditor` for `prd`/`spec`, Approve / Request-changes actions; for `publish`, a confirmation step before the irreversible approve (spec rule 5).
**Where**: `apps/frontend/src/components/analysis/ApprovalGate.tsx` (new)
**Depends on**: T28, T26
**Reuses**: `ExcerptCommentEditor` (T28), `useAnalysisRun`'s new actions (T26)
**Requirement**: HITL-02, HITL-03, HITL-04, HITL-05

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] "Request changes" disabled until at least one annotation exists (mirrors the 400 rule from T17/T22 — caught client-side too, not just server-side)
- [ ] `publish` stage requires an explicit confirm click before the approve call fires
- [ ] `tsc -b` + `oxlint` clean

**Tests**: none
**Gate**: build

---

### T30: `IterationHistory` component [P]

**What**: Renders `prdIterations`/`specIterations` as a timeline (version N, its annotations, timestamp).
**Where**: `apps/frontend/src/components/analysis/IterationHistory.tsx` (new)
**Depends on**: T24
**Reuses**: `AnalysisHistoryList`'s list-rendering style as a visual reference
**Requirement**: HITL-04

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Renders 0..N iterations without special-casing the empty state ugly
- [ ] `tsc -b` + `oxlint` clean

**Tests**: none
**Gate**: build

---

### T31: Wire `AnalysisPage`

**What**: Add 3 policy selectors (`prd`/`spec`/`publish`) to the run form; render `ApprovalGate` when `phase === 'awaiting_approval'`; render `IterationHistory` alongside the report; add a "Retomar" button for saved analyses with status `running`/`error`.
**Where**: `apps/frontend/src/pages/AnalysisPage.tsx`
**Depends on**: T29, T30, T26
**Reuses**: Existing form/section structure in the same file
**Requirement**: HITL-01, HITL-02, HITL-03, HITL-04, HITL-05

**Tools**: MCP: NONE · Skill: NONE

**Done when**:
- [ ] Policy selectors default to `manual` (spec default) and are included in the `start()` payload
- [ ] `ApprovalGate` shown/hidden correctly across phase transitions
- [ ] "Retomar" only shown for `running`/`error` saved analyses, calls `resume()`
- [ ] `tsc -b` + `oxlint` clean

**Tests**: none
**Gate**: build

---

## Parallel Execution Map

```
Phase 1 (Foundation, parallel):
  T1, T2, T3, T4, T5, T6 [P] ──→ T7

Phase 2/3/4 (three tracks, parallel with each other):

  ai-api track:
    T8 ─┐
    T9 ─┼→ T11 → T12 → T13 → T14 → T15
    T10─┘

  Nest track:
    T16 ─┐
    T17 ─┼→ T20 ──┬→ T21 ─┐
    T18 ─┤         └→ T22 ─┼→ T23 (needs T14 too)
    T19 ─┘                 ┘

  Frontend track:
    T24 ─┬→ T25 → T26 ──────────────┐
         ├→ T27 [P]                 │
         ├→ T28 → T29 ──────────────┼→ T31
         └→ T30 [P] ─────────────────┘
```

**Parallel-safe within Phase 1**: T1–T6 touch disjoint files, no shared state, all `unit`/`none` test types → safe.

**NOT parallel**: T15 (integration) and T23 (e2e) — per TESTING.md's Parallelism Assessment, both share Redis/Postgres containers and a `thread_id`/`analysis.id` lifecycle. Run them in isolation from any other integration/e2e task, even though their code dependencies are already satisfied.

---

## Task Granularity Check

| Task | Scope | Status |
|---|---|---|
| T1–T6 | 1 file each | ✅ Granular |
| T7 | 1 file (type mirror) | ✅ Granular |
| T8 | 1 new file, 1 concept (approval node factory) | ✅ Granular |
| T9, T10 | 1 file each, 1 branch added | ✅ Granular |
| T11 | 1 file (graph wiring) | ✅ Granular |
| T12 | 1 file, but splits into 2 functions — cohesive (same subsystem, same contract) | ✅ Granular |
| T13 | 1 file (lifespan) | ✅ Granular |
| T14 | 1 file, 2 routes — cohesive (same router, shared response shape) | ✅ Granular |
| T15 | 1 new test file | ✅ Granular |
| T16 | 1 method, 1 file | ✅ Granular |
| T17 | 2 new DTO files, cohesive (same validation concern) | ✅ Granular |
| T18 | 2 files (entity + types), cohesive (one data-shape change) | ✅ Granular |
| T19 | 1 file | ✅ Granular |
| T20 | 1 file, 1 extraction + 1 gating change — cohesive (same method being refactored) | ✅ Granular |
| T21, T22 | 1 method + 1 route each — cohesive (route is trivial wiring to the method) | ✅ Granular |
| T23 | 1 new test file | ✅ Granular |
| T24 | 1 type file | ✅ Granular |
| T25 | 1 file, 3 methods — cohesive (same client, shared SSE helper) | ✅ Granular |
| T26 | 1 file, 1 extraction + 3 actions — cohesive (same hook) | ✅ Granular |
| T27 | 2 small files, cohesive (same visual concern: approval-state rendering) | ✅ Granular |
| T28, T29, T30 | 1 new component each | ✅ Granular |
| T31 | 1 file (page wiring) | ✅ Granular |

No task exceeds "2–3 related things in the same file" — all pass.

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
|---|---|---|---|
| T1–T6 | None | None (parallel root) | ✅ Match |
| T7 | T6 | T6 → T7 | ✅ Match |
| T8 | T5, T6 | T5,T6 → T8 | ✅ Match |
| T9 | T5 | T5 → T9 | ✅ Match |
| T10 | T5 | T5 → T10 | ✅ Match |
| T11 | T8, T9, T10 | T8,T9,T10 → T11 | ✅ Match |
| T12 | T11, T6 | T11 → T12 (T6 shown via T8's inbound edge, same node reused) | ✅ Match |
| T13 | T12, T3 | T12,T3 → T13 | ✅ Match |
| T14 | T13, T12 | T13 → T14 | ✅ Match |
| T15 | T14 | T14 → T15 | ✅ Match |
| T16 | T7 | T7 → T16 | ✅ Match |
| T17 | T7 | T7 → T17 | ✅ Match |
| T18 | T4 | T4 → T18 | ✅ Match |
| T19 | T7, T18 | T18 → T19 (T7 inbound already established at T16/T17) | ✅ Match |
| T20 | T16, T18, T19 | T16,T17,T18,T19 → T20 | ✅ Match |
| T21 | T20 | T20 → T21 | ✅ Match |
| T22 | T20, T17 | T20 → T22 | ✅ Match |
| T23 | T21, T22, T14 | T21,T22 → T23 (T14 cross-track edge called out in prose) | ✅ Match |
| T24 | T7 | T7 → T24 | ✅ Match |
| T25 | T24 | T24 → T25 | ✅ Match |
| T26 | T25 | T25 → T26 | ✅ Match |
| T27 | T24 | T24 → T27 [P] | ✅ Match |
| T28 | T24 | T24 → T28 | ✅ Match |
| T29 | T28, T26 | T28 → T29, T26 → T31 (T29 also gated on T26 per prose — diagram simplified, both inbound edges are real) | ✅ Match |
| T30 | T24 | T24 → T30 [P] | ✅ Match |
| T31 | T29, T30, T26 | T29,T30,T26 → T31 | ✅ Match |

No task marked `[P]` depends on another task in the same parallel group (T1–T6 mutually independent; T9/T10 independent of each other; T27/T30 independent of the rest of their track's chain).

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
|---|---|---|---|---|
| T1 | infra (compose) | none | none | ✅ OK |
| T2 | infra (deps/config) | none | none | ✅ OK |
| T3 | ai-api config | none | none | ✅ OK |
| T4 | migration | none | none | ✅ OK |
| T5 | ai-api graph state | unit | unit | ✅ OK |
| T6 | ai-api schemas | unit | unit | ✅ OK |
| T7 | Nest types | none | none | ✅ OK |
| T8 | ai-api graph node | unit | unit | ✅ OK |
| T9, T10 | ai-api agent nodes | unit | unit | ✅ OK |
| T11 | ai-api graph wiring | unit | unit | ✅ OK |
| T12 | ai-api checkpointer wiring/resume flow | unit (structural) + integration (durability, deferred to T15) | unit | ✅ OK — integration coverage lives in T15 per design, not deferred silently: T15 explicitly named and required, not "tested elsewhere" hand-wave |
| T13 | ai-api checkpointer wiring | integration-adjacent | none (smoke only) | ✅ OK — the actual integration assertions are T15's job, T13 only wires the lifespan |
| T14 | ai-api routes | unit | unit | ✅ OK |
| T15 | ai-api checkpointer wiring | integration | integration | ✅ OK |
| T16 | Nest service (client) | unit | unit | ✅ OK |
| T17 | Nest DTO | unit | unit | ✅ OK |
| T18 | Nest entity/types | none | none | ✅ OK |
| T19 | Nest helper | unit | unit | ✅ OK |
| T20 | Nest service | unit | unit | ✅ OK |
| T21, T22 | Nest service+controller | unit | unit | ✅ OK |
| T23 | Nest full HTTP flow | e2e | e2e | ✅ OK |
| T24–T31 | Frontend components | none (build gate only) | none | ✅ OK |

No violations. T12/T13's split (unit now, integration in T15) is the "merge forward" pattern from the skill's compilation-dependency rule: the checkpointer wiring can't be meaningfully integration-tested until routes exist end-to-end (T14), so the integration assertions live in the earliest task where they become runnable — T15 — not silently dropped.

---

## Notes / Deferred (not tasks)

- Spec's "GIF for README" success criterion is a demo artifact, not a code task — record it manually after T15 passes.
- `auto_safe` for `publish` degrading to `manual` when PRD 04's guardrail signal doesn't exist yet (design's Open Item #3) — no separate task; T20's publish-gating logic should treat a missing guardrail signal as "fail closed" (manual) by construction, not as a TODO.
