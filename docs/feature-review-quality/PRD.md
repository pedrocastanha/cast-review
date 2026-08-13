# PRD: Qualidade do review (veredito, convenções padrão, relatório útil)

- **Status:** Implementado
- **Data:** 2026-08-13
- **Escopo:** `apps/ai-api` (prompts, convenções, report builder) + persistência/leitura no Nest + `apps/frontend` (ReportView)

## Problema

Rodei a PR #9 (`feature/start-ai-integration`) com o usuário `pedrocastanha`. O pipeline completou, persistiu e o front mostrou o snapshot — mas o review **não era útil**:

- Architecture Reviewer devolveu **100 sem nenhum finding** porque o repo não tem `conventions.md`. O reviewer mais importante virou no-op.
- O PRD saiu genérico e em inglês ("AI API Enhancement"), ignorando Nest e frontend no mesmo diff (113 arquivos).
- A spec inventou regra tautológica ("sem convenções o score é 100") em vez de regras de produto.
- O relatório era um dump de seções, sem veredito. Dois 100 num diff enorme parece review de mentira.
- O front listava os 113 arquivos e misturava pass com fail.

## Objetivo

Fazer o Cast Review devolver um parecer que um revisor humano usaria: veredito, nota geral, findings ancorados em convenção, PRD em português cobrindo as camadas da PR, e uma UI que destaca o que precisa de atenção.

## Requisitos funcionais

| # | Requisito |
|---|-----------|
| RF1 | Sem `conventions.md` no repo, o Architecture Reviewer usa o padrão Cast Review (`graph/conventions/default.md`) e **roda o LLM**. |
| RF2 | A origem das convenções (`repo` \| `default`) vai no payload do reviewer e no relatório. |
| RF3 | O Report Builder calcula em código `verdict`, `overallScore`, `failCount`, `warningCount`. |
| RF4 | Veredito: `approve` se não há fail (e < 3 warnings); `comment` se 1 fail ou ≥3 warnings; `request_changes` se ≥2 fails. |
| RF5 | Nota geral = menor score entre reviewers. |
| RF6 | Prompts de PRD/spec/reviewers pedem texto em português e proíbem resumo que ignore camadas do diff. |
| RF7 | O Nest persiste e devolve os campos novos no `report` jsonb. |
| RF8 | O front mostra herói de veredito + nota, lista no máximo 12 arquivos, e separa "precisa de atenção" do que passou. |

## Requisitos não funcionais

| # | Requisito |
|---|-----------|
| RNF1 | Score e veredito continuam testáveis sem rede. |
| RNF2 | apiKeys continuam fora de log, banco e markdown. |
| RNF3 | Edges do grafo não mudam. |

## Critérios de aceite

- [x] Repo sem conventions.md: architecture chama LLM com o padrão Cast Review (`conventionsSource=default`).
- [x] Relatório traz veredito + nota geral no JSON e no markdown.
- [x] Testes unitários de `resolve_conventions` e `decide_verdict` passam sem OpenAI.
- [x] Front typecheck inclui `verdict` / `overallScore`.

## Fora de escopo

- Comentar automaticamente na PR do GitHub.
- Novo reviewer (security, performance).
- Trocar a fórmula 100 − 15×fail − 5×warning.
