---
id: fail-uncovered-rules
type: coverage
how: code
when: after the model returns, or when the PR has no test files
---

Any businessRule without a finding becomes fail. If the PR has no test
files, skip the model and fail every rule. Enforced in `agent.py` so
the score cannot rise because the model forgot a rule.
