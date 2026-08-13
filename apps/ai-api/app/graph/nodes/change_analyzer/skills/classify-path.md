---
id: classify-path
type: path
how: code
when: every file in changedFiles
---

Classify using directory markers (`/test/`, `/tests/`, `/__tests__/`),
filename markers (`.test.`, `.spec.`, `_test.`, `test_`), then migration
markers (`migrations/`, `alembic/`), then config extensions.
Order: test > migration > config > source.
