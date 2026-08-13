---
id: describe-shipped-change
type: product
how: prompt
when: always, before the model call
---

Write the PRD of what this pull request already shipped. Prefer evidence
from the diff over commit-message guesses. If the change is tiny, keep
every field short. Empty `nonGoals` or `constraints` is valid.
