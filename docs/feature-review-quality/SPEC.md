# SPEC: Qualidade do review

- **Data:** 2026-08-13
- **Implementa:** `docs/feature-review-quality/PRD.md`

## Contratos

### `resolve_conventions(raw) -> (text, source)`

- `raw` com texto → `source="repo"`.
- `raw` vazio → lê `apps/ai-api/app/graph/conventions/default.md`, `source="default"`.

### Payload `architecture_reviewer_done`

Além de `score` + `findings`:

```json
{ "score": 95, "findings": [], "conventionsSource": "default" }
```

### Payload `report_ready` (campos novos)

```json
{
  "verdict": "approve | comment | request_changes",
  "overallScore": 85,
  "failCount": 1,
  "warningCount": 0,
  "headline": "título do PRD",
  "conventionsSource": "repo | default"
}
```

### Veredito

| Condição | verdict |
|----------|---------|
| 0 fail e < 3 warning | `approve` |
| 1 fail ou ≥ 3 warning | `comment` |
| ≥ 2 fail | `request_changes` |

`overallScore` = mínimo dos scores dos reviewers.

## Arquivos

| Peça | Onde |
|------|------|
| Convenções padrão | `apps/ai-api/app/graph/conventions/default.md` |
| Resolver | `apps/ai-api/app/graph/utils/conventions.py` |
| Veredito | `apps/ai-api/app/graph/utils/verdict.py` |
| Report | `apps/ai-api/app/graph/nodes/report_builder/agent.py` |
| Architecture | `apps/ai-api/app/graph/agents/architecture_reviewer/agent.py` |
| Persistência | `apps/backend/.../apply-review-event.ts` + `analyses.types.ts` |
| UI | `apps/frontend/src/components/analysis/ReportView.tsx` |

## Testes

- `tests/test_verdict.py` — fallback de convenções + tabela de veredito.
- `tests/test_reviewers.py` — conventions vazio chama LLM com padrão.
- `tests/test_agent_run.py` — `report_ready` carrega `verdict` / `overallScore` / `conventionsSource`.
- `apply-review-event.spec.ts` — snapshot continua hidratando results/comments.

## Fluxo

1. Change analyzer (igual).
2. PRD em português, cobrindo todas as camadas do diff.
3. Spec com no máximo 8 regras observáveis.
4. Test reviewer: `pass` só se o teste exercita a regra.
5. Architecture reviewer: sempre com convenções resolvidas.
6. Report builder agrega veredito + markdown.
7. Nest grava o snapshot; front mostra o herói.
