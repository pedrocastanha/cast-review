# Cross-Repo Impact Review — Implementation Tasks

**Status:** Implemented — browser validation in progress

**Commits:** Authorized on 2026-08-25

## Task 1 — Scope contracts and persistence

- [x] Add failing backend tests for default, valid and invalid `impactScope` parsing.
- [x] Add failing persistence tests for the analysis scope summary.
- [x] Implement DTO/shared types, analysis JSONB field and migration.
- [x] Verify: CRIR-01, CRIR-03, CRIR-13.

## Task 2 — Eligibility and frozen project scope

- [x] Add failing tests for eligible-project filtering and ownership isolation.
- [x] Add failing tests for exact, degraded and fallback member resolution.
- [x] Implement eligibility endpoint and scope resolver.
- [x] Wire authorization before analysis creation.
- [x] Verify: CRIR-02, CRIR-03, CRIR-05, CRIR-12.

## Task 3 — Base/head analysis input

- [x] Add failing tests for base content, removed files and frozen scope payload.
- [x] Extend GitHub pull/file context and AI run payload.
- [x] Prove repository mode does not resolve or send project context.
- [x] Verify: CRIR-04, CRIR-05, CRIR-06.

## Task 4 — Deterministic contract deltas

- [x] Add immutable fixtures for added, removed, modified and touched contracts.
- [x] Implement conservative base/head pairing and omission records.
- [x] Verify deterministic serialization.
- [x] Verify: CRIR-06, CRIR-14.

## Task 5 — Frozen cross-repo traversal

- [x] Add failing AI tests for provider→consumer and consumer→provider traversal.
- [x] Add repository/SHA-constrained Neo4j lookup.
- [x] Implement impact/evidence IDs, classification and deterministic budget.
- [x] Verify no same-repository or fuzzy confirmed match is emitted.
- [x] Verify: CRIR-07, CRIR-08, CRIR-13, CRIR-14.

## Task 6 — Snapshot v2 and fail-open pipeline

- [x] Add failing tests for v2 hash, exact/degraded/fallback and v1 compatibility.
- [x] Integrate cross-repo resolver into change analysis only for project mode.
- [x] Persist the complete context and effective scope.
- [x] Continue local reviewers on graph failure.
- [x] Verify: CRIR-09, CRIR-10, CRIR-12, CRIR-15.

## Task 7 — Evidence-bound review results

- [x] Add failing tests for deterministic impact findings and evidence validation.
- [x] Render cross-repo context for reviewers.
- [x] Add report findings with valid evidence IDs.
- [x] Prove external paths never become inline GitHub comments.
- [x] Verify: CRIR-09, CRIR-16.

## Task 8 — Opt-in frontend

- [x] Add API/type checks and browser scenarios for default-off behavior and eligibility states.
- [x] Implement scope card, project selection, readiness and setup guidance.
- [x] Reset scope on every new analysis.
- [x] Verify: CRIR-01, CRIR-02, CRIR-04.

## Task 9 — Snapshot and history frontend

- [x] Validate v1/v2 rendering and degraded/fallback warnings.
- [x] Implement impact/evidence inspector and scope history badge.
- [x] Verify: CRIR-10, CRIR-11, CRIR-15.

## Task 10 — End-to-end validation

- [x] Run complete backend, AI API and frontend suites/builds.
- [x] Exercise repository mode and verify zero project-graph requests in automated tests.
- [ ] Exercise project mode with the dogfood project.
- [ ] Exercise degraded/fallback behavior.
- [ ] Reopen the completed analysis and verify immutable evidence.
- [ ] Capture browser screenshots and document evidence.
- [ ] Update requirement status and implementation notes.
