# TASKS: Ciclo de vida dos findings

**SPEC:** [SPEC.md](./SPEC.md)
**Status:** Em andamento

## Premissas de execução

- O P1 segue o escopo `requestedBy + owner + repo + pullNumber`.
- O `ai-api` não será alterado.
- Testes RED da fase 1 são contrato imutável durante o GREEN correspondente.
- Não haverá matching fuzzy, backfill completo ou inbox por repositório.
- Commits serão atômicos e não incluirão os PRDs das features 6 e 7, que permanecem mudanças separadas.
- Execução local e sequencial; nenhum task usa subagente nesta sessão.

## Plano de execução

```text
T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10
```

## Tarefas

### T1 — Congelar plano e contratos

**Entrega:** PRD, SPEC e TASKS rastreáveis da feature.
**Arquivos:** `docs/feature-finding-lifecycle/{PRD,SPEC,TASKS}.md`
**Depende de:** nenhum
**Reutiliza:** convenções `docs/feature-*`
**Requisitos:** FL-01 a FL-15
**Testes:** nenhum — documentação
**Gate:** whitespace e links locais

### T2 — Implementar fingerprint v1

**Entrega:** função pura de fingerprint determinístico, normalização e agregação de duplicatas.
**Arquivos:** `finding-fingerprint.helper.ts` e `.spec.ts`
**Depende de:** T1
**Reutiliza:** `ReviewComment` e helpers puros do módulo analyses
**Requisitos:** FL-02, FL-03
**Testes:** unitários Jest, escritos primeiro
**Gate:** backend quick

### T3 — Implementar planejador de transições

**Entrega:** função pura que classifica `new`, `recurring`, `reopened` e `not_observed`, preservando disposição.
**Arquivos:** `finding-lifecycle.helper.ts` e `.spec.ts`
**Depende de:** T2
**Reutiliza:** output do fingerprint v1
**Requisitos:** FL-04 a FL-08
**Testes:** unitários Jest, escritos primeiro
**Gate:** backend quick

### T4 — Persistir cases, ocorrências e eventos

**Entrega:** entidades, repositories, migration, datasource e wiring no módulo.
**Arquivos:** `FindingCasesModule`, entidades/repositories de lifecycle, migration, `postgres.datasource.ts`, `analyses.module.ts`
**Depende de:** T3
**Reutiliza:** `DefaultEntity`, `DefaultRepository` e migrations TypeORM existentes
**Requisitos:** FL-02, FL-10
**Testes:** nenhum, conforme matriz para migrations; build neste task
**Gate:** backend build + lint

### T5 — Implementar serviço de reconciliação

**Entrega:** serviço transacional, idempotente, com baseline anterior e summary.
**Arquivos:** `finding-cases/use-cases/finding-lifecycle/finding-lifecycle.use-case.ts` e `.spec.ts`
**Depende de:** T4
**Reutiliza:** repositories e helpers dos T2/T3
**Requisitos:** FL-01 a FL-08, FL-11, FL-14, FL-15
**Testes:** unitários Jest, escritos primeiro
**Gate:** backend quick

### T6 — Integrar lifecycle ao relatório e GitHub

**Entrega:** reconciliação após `report_ready`, evento SSE, fail-open e supressão baseada na disposição atual.
**Arquivos:** `analyses.service.ts`, `analyses.types.ts`, `shared/types.ts`, `apply-review-event.ts`, `github-review.helper.ts` e specs existentes
**Depende de:** T5
**Reutiliza:** fluxo `streamLeg`, publisher e hydratação atuais
**Requisitos:** FL-01, FL-11, FL-13, FL-14
**Testes:** unitários Jest, escritos primeiro
**Gate:** backend quick

### T7 — Expor API de lifecycle e disposição

**Entrega:** GET paginado por cursor e PUT idempotente de disposição, com ownership.
**Arquivos:** `analyses.controller.ts`, `FindingCasesController`, DTO, services/use-cases e specs
**Depende de:** T6
**Reutiliza:** autenticação `CurrentUser` e envelope Nest existentes
**Requisitos:** FL-09, FL-10, FL-12
**Testes:** unitários Jest, escritos primeiro
**Gate:** backend quick

### T8 — Integrar contratos no frontend

**Entrega:** tipos, funções de API e helper de agrupamento/filtros de lifecycle.
**Arquivos:** `src/types/index.ts`, `src/api/analyses.api.ts`, helper e teste Node
**Depende de:** T7
**Reutiliza:** `http`, tipos de analysis e padrão de testes puros do frontend
**Requisitos:** FL-09, FL-11, FL-12
**Testes:** unitário Node para helper + typecheck
**Gate:** frontend test + build

### T9 — Construir experiência de lifecycle

**Entrega:** resumo, filtros, badges, feedback humano e fallback indisponível em `ReportView`.
**Arquivos:** componentes de lifecycle e `ReportView.tsx`
**Depende de:** T8
**Reutiliza:** tokens, `Pill`, `Card`, filtros e cards atuais
**Requisitos:** FL-09, FL-11, FL-12, FL-14
**Testes:** nenhum para componentes conforme matriz; build/lint e detector visual
**Gate:** frontend build + lint + Impeccable detector

### T10 — Validar fluxo integrado e fechar rastreabilidade

**Entrega:** E2E de persistência/API, todos os gates e atualização de status documental.
**Arquivos:** E2E backend e documentos da feature
**Depende de:** T9
**Reutiliza:** setup Postgres E2E existente
**Requisitos:** FL-01 a FL-15
**Testes:** E2E Jest + regressão completa
**Gate:** backend unit/E2E/build/lint + frontend test/build/lint

## Granularidade

| Task | Unidade coesa | Status |
| --- | --- | --- |
| T1 | contrato documental | OK |
| T2 | uma função pública de identidade | OK |
| T3 | uma função pública de transição | OK |
| T4 | uma unidade de persistência inseparável | OK |
| T5 | um serviço de aplicação | OK |
| T6 | um ponto de integração do pipeline | OK |
| T7 | um recurso HTTP com leitura/escrita correlatas | OK |
| T8 | contrato cliente do recurso | OK |
| T9 | uma superfície de UI | OK |
| T10 | gate integrado | OK |

## Cross-check de dependências

| Task | Depende de | Diagrama | Status |
| --- | --- | --- | --- |
| T1 | nenhum | início | OK |
| T2 | T1 | T1 → T2 | OK |
| T3 | T2 | T2 → T3 | OK |
| T4 | T3 | T3 → T4 | OK |
| T5 | T4 | T4 → T5 | OK |
| T6 | T5 | T5 → T6 | OK |
| T7 | T6 | T6 → T7 | OK |
| T8 | T7 | T7 → T8 | OK |
| T9 | T8 | T8 → T9 | OK |
| T10 | T9 | T9 → T10 | OK |

## Validação de co-localização de testes

| Task | Camada | Matriz exige | Task define | Status |
| --- | --- | --- | --- | --- |
| T1 | docs | nenhum | nenhum | OK |
| T2 | lógica Nest pura | unit | unit | OK |
| T3 | lógica Nest pura | unit | unit | OK |
| T4 | migration/wiring | nenhum | nenhum + build | OK |
| T5 | Nest service | unit | unit | OK |
| T6 | Nest service/helpers | unit | unit | OK |
| T7 | Nest controller/service | unit | unit | OK |
| T8 | helper frontend | teste Node disponível | unit + build | OK |
| T9 | componente frontend | build | build | OK |
| T10 | HTTP/Postgres | E2E | E2E | OK |

## Rastreabilidade de execução

| Task | Status | Verificação |
| --- | --- | --- |
| T1 | Concluído | whitespace, links e baseline verificados |
| T2 | Concluído | 5 testes novos; 230 backend; build + Biome focado |
| T3 | Concluído | 5 testes novos; 235 backend; build + Biome focado |
| T4 | Concluído | schema + constraints; 235 backend; build + Biome focado |
| T5 | Concluído | 5 testes novos; 240 backend; build + Biome focado |
| T6 | Concluída | Testes de integração, helpers, build e check focado verdes |
| T7 | Concluída | API com ownership, cursor assinado e PUT idempotente; testes e build verdes |
| T8 | Concluída | Tipos, client HTTP, montagem SSE e helper; typecheck/build verde |
| T9 | Em andamento | — |
| T10 | Pendente | — |
