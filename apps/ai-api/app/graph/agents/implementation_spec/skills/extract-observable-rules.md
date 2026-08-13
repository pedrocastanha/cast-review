---
id: extract-observable-rules
type: contract
how: prompt
when: always, before the model call
---

Extract only behaviors a test could assert. Prefer contract-level rules
("rejects negative amounts", "exports x") over implementation details
("uses a Map"). Cosmetic-only PRs may have an empty `businessRules` list.
One short sentence per rule. Deduplicate.
