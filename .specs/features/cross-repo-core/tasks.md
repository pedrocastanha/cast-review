# Cross-Repo Core Tasks

**Design:** `.specs/features/cross-repo-core/design.md`  
**Status:** Complete  
**Commits:** Disabled by explicit user request

## Execution Plan

```text
T1 ─→ T2 ─→ T3 ─→ T4
 │                 │
 └────→ T5 ─→ T6 ─┼─→ T7
                   └─→ T8 ─→ T9 ─→ T10 ─→ T11
```

## Tasks

### T1: Freeze product and technical contracts — COMPLETE

- **Where:** PRD, spec, context, design and SDD files
- **Requirement:** XREPO-01..10
- **Tests:** none
- **Gate:** `git diff --check`

### T2: Extract HTTP endpoints — COMPLETE

- **Where:** `apps/ai-api/app/code_graph/http_endpoints.py`, unit test
- **Depends on:** T1
- **Requirements:** XREPO-04, XREPO-05
- **Tests:** unit
- **Gate:** AI API quick
- **Done when:** Nest, FastAPI, request/fetch/Axios and route normalization fixtures pass.

### T3: Persist endpoints safely — COMPLETE

- **Where:** AI graph models/cache and cache integration test
- **Depends on:** T2
- **Requirements:** XREPO-04, XREPO-05, XREPO-07
- **Tests:** integration
- **Gate:** AI API full
- **Done when:** roundtrip and repo-scoped rebuild preserve other repos.

### T4: Materialize and expose project graph — COMPLETE

- **Where:** AI cache, route, models and project graph integration test
- **Depends on:** T3
- **Requirements:** XREPO-06, XREPO-08
- **Tests:** integration
- **Gate:** AI API full
- **Done when:** endpoint matches aggregate consumer repo → provider repo with evidence.

### T5: Persist project control plane — COMPLETE

- **Where:** migration, entities, repositories and datasource
- **Depends on:** T1
- **Requirements:** XREPO-01, XREPO-02
- **Tests:** e2e via migrated DB
- **Gate:** backend full/build
- **Done when:** constraints, indexes and cascade are active in Postgres.

### T6: Implement ProjectsModule — COMPLETE

- **Where:** backend projects module, DTOs, service, controller and unit tests
- **Depends on:** T5
- **Requirements:** XREPO-01, XREPO-02, XREPO-03
- **Tests:** unit
- **Gate:** backend quick
- **Done when:** CRUD owner-scoped, authorized members, enqueue and status pass.

### T7: Connect Nest to project graph API — COMPLETE

- **Where:** shared types, AI client and tests, ProjectsService graph method
- **Depends on:** T4, T6
- **Requirements:** XREPO-06, XREPO-08
- **Tests:** unit
- **Gate:** backend build
- **Done when:** only authorized repo/SHA refs reach FastAPI.

### T8: Add frontend project data layer — COMPLETE

- **Where:** types, API client and hooks
- **Depends on:** T7
- **Requirements:** XREPO-01, XREPO-03, XREPO-08
- **Tests:** none per matrix
- **Gate:** frontend build

### T9: Build projects list and editor — COMPLETE

- **Where:** routes, navbar, list page, editor page
- **Depends on:** T8
- **Requirements:** XREPO-01, XREPO-02, XREPO-10
- **Tests:** none per matrix
- **Gate:** frontend build

### T10: Build project graph and evidence UI — COMPLETE

- **Where:** project graph page and components
- **Depends on:** T9
- **Requirements:** XREPO-08, XREPO-09, XREPO-10
- **Tests:** none per matrix
- **Gate:** frontend build

### T11: Full validation and browser UAT — COMPLETE

- **Where:** all layers and validation report
- **Depends on:** T7, T10
- **Requirements:** XREPO-01..10
- **Tests:** unit + integration + browser
- **Gate:** all build-level gates
- **Done when:** login, create/edit, index/status and graph states are exercised in Chromium.

## Diagram-Definition Cross-Check

| Task | Body dependencies | Diagram | Status |
| --- | --- | --- | --- |
| T1 | None | root | ✅ |
| T2 | T1 | T1 → T2 | ✅ |
| T3 | T2 | T2 → T3 | ✅ |
| T4 | T3 | T3 → T4 | ✅ |
| T5 | T1 | T1 → T5 | ✅ |
| T6 | T5 | T5 → T6 | ✅ |
| T7 | T4, T6 | T4/T6 → T7 | ✅ |
| T8 | T7 | T7 → T8 | ✅ |
| T9 | T8 | T8 → T9 | ✅ |
| T10 | T9 | T9 → T10 | ✅ |
| T11 | T7, T10 | T7/T10 → T11 | ✅ |

## Test Co-location Validation

| Task | Layer | Matrix | Task | Status |
| --- | --- | --- | --- | --- |
| T2 | AI pure logic | unit | unit | ✅ |
| T3/T4 | Neo4j cache/routes | integration | integration | ✅ |
| T5 | migration | e2e migrated DB | e2e | ✅ |
| T6/T7 | Nest service/client | unit | unit | ✅ |
| T8/T9/T10 | frontend | build only | none/build | ✅ |
| T11 | user-facing integrated | build + UAT | full | ✅ |

## Validation Record

- Backend: 17 suites, 105 tests, build verde.
- AI API: 205 tests incluindo integrações reais com Redis e Neo4j.
- Frontend: 3 testes, TypeScript/Vite build e oxlint; apenas o warning preexistente de Fast Refresh em `AuthContext.tsx`.
- Postgres: migration `CreateProjects1787670000000` aplicada com constraints, índices e cascades.
- Chromium: login, create, edit, DTOs inválidos, unauthorized repository rejection, owner-scoped 404, index queue/status, graph e evidence inspector por teclado exercitados.
- Dogfood: `cast-frontend → cast-backend`, 2 índices, 75 endpoints relacionados, 1 ligação agregada e 42 matches confirmados.
- Responsividade: 390/768/1024/1440 px sem overflow horizontal; em 390 px, todos os controles interativos têm alvo mínimo de 44 × 44 px.
- Regressões adicionais: controllers NestJS múltiplos por arquivo, prefixo de `APIRouter`, isolamento por SHA e remoção das relações antigas do projeto.
