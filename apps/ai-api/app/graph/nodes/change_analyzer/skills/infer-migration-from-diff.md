---
id: infer-migration-from-diff
type: path
how: code
when: no changed path looks like a migration
---

Scan the raw unified diff for the same migration markers. A generated
migration that only appears in the patch still sets `hasMigration`.
