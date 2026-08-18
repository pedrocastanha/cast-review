# Durable Runs + Multi-Stage HITL Gates Specification

**Supersedes/extends:** `05-durable-runs-hitl.md` (original PRD — Postgres checkpointer, single gate before publish). This spec keeps that PRD's durability rationale and architecture boundary, but changes the checkpointer backend to Redis and generalizes the single publish gate into a 3-stage gate (`prd`, `spec`, `publish`).

## Problem Statement

The pipeline (PRD → SPEC → agents → report → GitHub publish) runs as an in-memory graph with no checkpoint. A closed tab, dropped connection, or container restart kills a run mid-pipeline and loses already-paid-for tokens. There is also no human checkpoint before the bot writes to a user's PR, nor before it commits to a PRD/SPEC direction the user might disagree with — today those stages run straight through with no pause point.

## Goals

- [ ] Run survives process/container restart — resume continues from the last completed node, does not reprocess it (verified by comparing token `usage` before/after a killed-and-resumed run)
- [ ] Human can gate the run at 3 points — after PRD, after SPEC, before GitHub publish — and reject/approve/annotate at each
- [ ] Zero GitHub writes without approval in `manual` policy (e2e test)
- [ ] Rejected-and-annotated PRD/SPEC gets reprocessed by the agent and resubmitted for approval, with prior iterations kept visible

## Out of Scope

| Feature | Reason |
|---|---|
| Distributed job queue (Celery/Arq) | Single process + checkpoint covers the MVP case |
| Multi-worker concurrency on the same `thread_id` | Out per original PRD 05, unchanged |
| Checkpoint time-travel / branching | Gained for free from LangGraph checkpointer, not built explicitly here |
| `auto_safe` policy for `prd`/`spec` stages | No objective signal (verdict/guardrail) exists at those stages yet; only `manual`/`auto` apply there. `auto_safe` stays exclusive to `publish` |
| Structured/diff-based comment UI beyond text selection + note | v1 is text selection + free-text note, not a rich diff editor |

---

## User Stories

### P1: Durable run survives restart ⭐ MVP

**User Story**: As the developer running an analysis, I want the run to survive a dropped connection or container restart so that I don't lose already-generated PRD/SPEC/report and don't pay for regenerating them.

**Why P1**: This is the foundation everything else (approval gates) depends on — a pause-and-wait-for-human step is only safe if the run is durable while waiting.

**Acceptance Criteria**:
1. WHEN the ai-api container is killed mid-run THEN the system SHALL allow resuming from the last completed node via `POST /agent/resume` without reprocessing completed nodes
2. WHEN a run resumes THEN the system SHALL reinject API keys/secrets at resume time and SHALL NOT have persisted them in the checkpoint
3. WHEN a browser tab closes mid-run THEN the backend run SHALL continue independently of the SSE connection, and reconnecting SHALL reattach to the in-progress stream without restarting it

**Independent Test**: Start a run, `docker kill` the ai-api container after PRD is generated, call resume, confirm SPEC generation starts without a new PRD generation call (check token usage).

---

### P1: Approval gate after PRD generation ⭐ MVP

**User Story**: As the developer, I want to review and approve the generated PRD before the agent moves to SPEC, so I can redirect the analysis before the agent commits to a wrong direction.

**Why P1**: This is the core ask — catching drift at the cheapest possible point (right after PRD, before the more expensive SPEC + agent stages run on a wrong premise).

**Acceptance Criteria**:
1. WHEN PRD generation completes THEN the system SHALL emit an SSE `awaiting_approval` event with `stage: "prd"` and the full PRD content, and SHALL set `analyses.status = awaiting_approval`
2. WHEN the run's `publish_policy` (per-stage) for `prd` is `manual` THEN the system SHALL NOT proceed to SPEC generation until an approval decision is received
3. WHEN the user approves THEN the system SHALL proceed to SPEC generation
4. WHEN the user rejects with no annotations THEN the system SHALL mark the run `error` with a clear message (no silent stop)
5. WHEN the per-stage policy is `auto` THEN the system SHALL skip the pause and proceed automatically, recording `approval.by = "policy"`

**Independent Test**: Run with `prd` policy = `manual`, confirm run stops at `awaiting_approval` with `stage: "prd"` and does not call the SPEC node until `POST /analyses/:id/approve` is called.

---

### P1: Approval gate after SPEC generation ⭐ MVP

**User Story**: As the developer, I want the same approve/edit/reject flow after SPEC generation, before the analysis agents run.

**Why P1**: Same value as the PRD gate, one stage later — SPEC is the more detailed/expensive artifact and the last checkpoint before the costly multi-agent analysis runs.

**Acceptance Criteria**:
1. WHEN SPEC generation completes THEN the system SHALL emit `awaiting_approval` with `stage: "spec"` and the full SPEC content
2. Same manual/auto policy behavior as the PRD gate (criteria 2, 3, 4, 5 above), scoped to `spec`

**Independent Test**: Same as PRD gate test, but for the SPEC → agents transition.

---

### P1: Edit via inline comments, agent reprocesses ⭐ MVP

**User Story**: As the developer, I want to select a passage in the PRD/SPEC and leave a note on what to change, and have the agent apply it and resubmit for approval — not just accept my raw edit blind.

**Why P1**: This is the explicit trade-off the user chose over "accept edit as final" — safer (agent keeps the doc internally consistent and validates it can still feed the next stage), at the cost of another generation round.

**Acceptance Criteria**:
1. WHEN the user submits one or more `{excerpt, note}` annotations on a `prd`/`spec` stage THEN the system SHALL send them to the agent as revision instructions and SHALL NOT treat the raw excerpt edit as final content
2. WHEN the agent finishes reprocessing THEN the system SHALL emit a new `awaiting_approval` event for the same stage with the revised content, incrementing the iteration count
3. WHEN the user submits a reject/edit action with zero annotations THEN the system SHALL reject the request at the API layer (400) rather than silently no-op or silently approving — an edit action requires at least one annotation
4. WHEN reprocessing happens THEN the system SHALL keep the prior iteration(s) readable (not overwritten)

**Independent Test**: Approve-flow UI, add a comment on a PRD paragraph, submit, confirm a new PRD version appears in `awaiting_approval` again and the previous version is still visible in the iteration history.

---

### P2: Approval gate before GitHub publish

**User Story**: As the developer, I want the existing publish gate (from PRD 05) folded into the same generalized mechanism, including its `auto_safe` policy.

**Why P2**: Functionally already speced in PRD 05; here it's a re-plumbing onto the generalized node rather than new behavior, so it's lower net-new risk than the PRD/SPEC gates.

**Acceptance Criteria**: Same as PRD 05's `human_approval` node — `manual` (default) / `auto_safe` (publish only, based on verdict + guardrail severity) / `auto`.

**Independent Test**: Reuse PRD 05's e2e test — zero GitHub comments published without approval in `manual` mode.

---

### P2: Redis Stack as checkpointer backend

**User Story**: As the developer, I want the LangGraph checkpointer backed by Redis Stack instead of Postgres, so the run-durability layer is decoupled from the domain database.

**Why P2**: Infra choice, not user-facing behavior — the durability *guarantee* (P1 story above) is what's user-facing; the backend is an implementation decision.

**Acceptance Criteria**:
1. WHEN the graph is compiled THEN the system SHALL use `langgraph-checkpoint-redis`'s `AsyncRedisSaver` against a `redis-stack-server` instance (RedisJSON + RediSearch modules required by the library)
2. WHEN Redis is provisioned THEN the compose config SHALL set `appendonly yes` and `maxmemory-policy noeviction` — checkpoint data is durable state, not a cache, and default Redis behavior (TTL/eviction under memory pressure) would silently reintroduce the exact data-loss bug this feature fixes
3. WHEN domain data is written (analyses, users, etc.) THEN it SHALL remain in Postgres via TypeORM — Redis holds only checkpoint state, never domain records

**Independent Test**: Fill Redis near `maxmemory`, confirm writes fail loudly (no eviction of checkpoint keys) rather than silently dropping run state.

---

### P2: Cleanup job for stale `awaiting_approval` runs

**User Story**: As the developer, I want a run stuck waiting for approval for 24h to auto-expire into `error` with a clear message, so it doesn't linger forever.

**Why P2**: Data hygiene / operational safety net, not required for the demo happy path.

**Acceptance Criteria**:
1. WHEN a run has been `awaiting_approval` (any stage — `prd`, `spec`, or `publish`) for more than 24h THEN a cleanup job SHALL transition it to `error` with a message identifying the expired stage
2. The 24h timeout SHALL be uniform across all 3 stages (no per-stage differentiation)

**Independent Test**: Manually backdate an `awaiting_approval` row's timestamp past 24h, run the cleanup job, confirm status flips to `error`.

---

### P3: SSE reconnection to in-progress run

**User Story**: As the developer, I want to reopen a tab and reattach to a run's live event stream without restarting it.

**Why P3**: Quality-of-life on top of the durability guarantee — the run already survives without this; this just restores live visibility. (Also already speced in PRD 05.)

**Acceptance Criteria**: Same as PRD 05 — v1 reconnection replays persisted `thoughts` then resumes live streaming from the current node.

---

## Edge Cases

- WHEN Redis is unreachable at graph-compile time THEN the system SHALL fail run startup with a clear error, not silently fall back to in-memory (no silent durability downgrade)
- WHEN an edited PRD/SPEC annotation targets an excerpt that no longer matches the current content exactly (stale selection) THEN the system SHALL reject the annotation submission with a clear error rather than silently dropping it
- WHEN `api_keys` would be serialized into a checkpoint THEN a test SHALL fail the build — keys live only in `configurable`, never in `GraphState`
- WHEN the graph interrupts mid-node THEN restart-and-resume SHALL NOT re-run that node partially twice (idempotency boundary is per-node, not per-substep — inherited from LangGraph's checkpoint granularity)
- WHEN a run is rejected with annotations at the `spec` stage THEN reprocessing SHALL re-run only the SPEC node, not regenerate the already-approved PRD

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
|---|---|---|---|
| HITL-01 | P1: Durable run survives restart | Design | Pending |
| HITL-02 | P1: Approval gate after PRD | Design | Pending |
| HITL-03 | P1: Approval gate after SPEC | Design | Pending |
| HITL-04 | P1: Edit via inline comments, reprocess | Design | Pending |
| HITL-05 | P2: Approval gate before publish | Design | Pending |
| HITL-06 | P2: Redis Stack checkpointer | Design | Pending |
| HITL-07 | P2: Cleanup job for stale approvals | Design | Pending |
| HITL-08 | P3: SSE reconnection | Design | Pending |

**Coverage:** 8 total, 0 mapped to tasks, 8 unmapped ⚠️ (expected — Tasks phase not yet run)

## Success Criteria

- [ ] Kill the ai-api container mid-run, resume, confirm PRD/SPEC already generated are not reprocessed (GIF for README, per original PRD 05)
- [ ] A run with all 3 stages set to `manual` produces 3 distinct `awaiting_approval` events end to end, with zero auto-skips
- [ ] An annotated PRD rejection produces a visibly different v2 PRD, with v1 still inspectable
- [ ] Zero GitHub comments published without approval in `manual` mode (e2e test, reused from PRD 05)
