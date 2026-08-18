# Testing

Scoped for the `durable-runs-hitl-gates` feature — first feature in this repo needing real integration tests (Redis, cross-process resume). Extend this doc as more features land.

## Test Coverage Matrix

| Code Layer | Required Test Type | Parallel-Safe |
|---|---|---|
| ai-api graph nodes / pure logic (prompts, routing functions, revision-note handling) | unit (pytest, LLM calls faked via `tests/llm_fakes.py`) | Yes |
| ai-api checkpointer wiring, interrupt/resume flow, Redis durability config | integration (`@pytest.mark.integration`, real Redis Stack) | No |
| Nest services/controllers (business logic, DTO validation, event application) | unit (Jest) | Yes |
| Nest full HTTP flow (run → approve → resume against real Postgres) | e2e (Jest, `test/jest-e2e.json`) | No |
| Frontend components (approval screen, comment-on-excerpt, iteration history) | none — build gate only | N/A |
| Migrations | none — verified via backend e2e running against a migrated DB | N/A |

## Gate Check Commands

| Gate | Command | Notes |
|---|---|---|
| ai-api quick | `cd apps/ai-api && pytest -m "not integration"` | No external services needed |
| ai-api full | `docker compose up -d redis postgres && cd apps/ai-api && pytest` | Requires `redis` service in `docker-compose.yml` (added by this feature) |
| backend quick | `cd apps/backend && npm run test` | Jest unit, no external services |
| backend full | `docker compose up -d postgres && cd apps/backend && npm run test:e2e` | Existing e2e pattern, already Postgres-dependent |
| frontend build | `cd apps/frontend && npx tsc -b && npx oxlint` | No test runner in this project; type-check + lint is the gate |

## Parallelism Assessment

- Unit tests (ai-api, Nest) — parallel-safe, no shared external state.
- Integration/e2e tests — **not** parallel-safe. They share a Redis/Postgres container and, more specifically, a `thread_id`/`analysis.id` namespace across a run's lifecycle (start → pause → resume). Tasks whose `Tests` field is `integration` or `e2e` must not carry `[P]` even if their code has no dependency on other in-flight tasks.

## Conventions

- New pytest marker `integration` must be registered in `apps/ai-api/pytest.ini` (`markers = integration: requires real Redis`) as part of the first task that adds an integration test — don't add it as a separate task.
- "No silent test deletion": every task's Done-when includes an expected pass count, not just "gate passes".
