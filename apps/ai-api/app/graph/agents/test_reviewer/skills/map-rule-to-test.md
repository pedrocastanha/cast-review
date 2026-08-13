---
id: map-rule-to-test
type: coverage
how: prompt
when: the PR has at least one test file
---

One finding per businessRule. `fail` if no matching test exists.
A matching test is any test file or block that names or exercises the
same behavior. Framework does not matter. Do not comment on how good
the test is.
