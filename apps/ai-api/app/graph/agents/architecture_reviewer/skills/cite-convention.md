---
id: cite-convention
type: convention
how: prompt
when: conventions.md is non-empty
---

A finding is valid only if `conventionRef` is a quote or `L<n>:` line
taken from the provided conventions.md. If the change feels wrong but
no line supports it, omit the finding. Prefer `fail` for a hard rule
and `warning` for a soft preference.
