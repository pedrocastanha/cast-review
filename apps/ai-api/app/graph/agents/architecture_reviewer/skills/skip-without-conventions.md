---
id: skip-without-conventions
type: convention
how: code
when: conventions do repo e o fallback padrão estão ambos vazios
---

Só pule o LLM se `resolve_conventions` devolver texto vazio.
Repo sem `conventions.md` usa o padrão Cast Review e o reviewer roda normalmente.
