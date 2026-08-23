# Plano de execução: Context Snapshot e Benchmark Lab

**Status:** Concluído
**PRD:** `PRD.md`
**Design:** `SDD.md`

## Dependências

```text
T1 → T2 → T3
      └→ T4 → T5 → T6
```

## T1 — Gerar snapshot determinístico no ai-api

- Requisito: RF-S1 a RF-S5
- Entrega: contrato, hash canônico, subgrafo selecionado e suporte a contexto congelado.
- Testes: unitários Python.
- Verificação: `pytest` dos módulos de snapshot/change analyzer/pipeline.
- Status: concluído.

## T2 — Persistir e consultar snapshot no backend

- Requisito: RF-S1, RF-S6, RF-S7
- Depende de: T1
- Entrega: entity, repository, migration, persistência no SSE e endpoint autenticado.
- Testes: unitários Jest de persistência/autorização.
- Verificação: testes do módulo analyses + build.
- Status: concluído.

## T3 — Exibir o contexto usado na análise

- Requisito: RF-V1 a RF-V6
- Depende de: T2
- Entrega: painel carregado sob demanda com resumo, filtros, subgrafo e aviso stale.
- Testes: typecheck/build e UAT no Chrome.
- Verificação: `npm run build` no frontend.
- Status: concluído.

## T4 — Salvar e listar casos privados

- Requisito: RF-B2, RF-B3, RF-B7, RF-B9, RF-B10
- Depende de: T2
- Entrega: entidades, migration e API de casos copiados de uma análise.
- Testes: unitários Jest de cópia e isolamento por usuário.
- Verificação: testes do módulo benchmarks + build.
- Status: concluído.

## T5 — Executar comparação com contexto congelado

- Requisito: RF-B4 a RF-B7, RF-B9
- Depende de: T1, T4
- Entrega: execução dos modelos contra o mesmo snapshot, resultados, custo e latência persistidos.
- Testes: unitários do runner e contrato frozenContext no Python.
- Verificação: testes backend/ai-api + builds.
- Status: concluído.

## T6 — Benchmark Lab e validação visual

- Requisito: BENCH-02, BENCH-03, BENCH-04
- Depende de: T3, T5
- Entrega: lista de casos, criação a partir de análise, seleção de modelos e comparação exploratória.
- Testes: frontend build, navegação e inspeção visual no Chrome em desktop e mobile.
- Verificação: build dos três apps e UAT com Playwright/Chrome.
- Status: concluído.

## T7 — Catálogo oficial versionado

- Requisito: BENCH-01, RF-B1, RF-B5, RF-B7.
- Depende de: T4, T5, T6.
- Entrega: oito PRs públicas congeladas, gerador reproduzível, migration idempotente e metadados de auditoria na UI.
- Testes: contrato de fixture, hash canônico, acesso global, somente leitura e banco real.
- Verificação: Jest, builds, migration executada duas vezes e UAT no Chrome.
- Status: concluído.

## T8 — Contexto original da PR no Lab

- Requisito: RF-B11, RF-B12.
- Depende de: T7.
- Entrega: body/título originais congelados, migration para instalações existentes e painel com descrição, arquivos e diff antes da comparação.
- Testes: contrato das fixtures, normalização do conteúdo e UAT responsivo no Chrome.
- Verificação: Jest focal, teste Node do frontend, builds e migration em banco real.
- Status: concluído.

## Resultado de validação

- ai-api: 192 testes passaram.
- backend: 96 testes passaram; build passou; migration do catálogo aplicada e repetida sem duplicação.
- frontend: typecheck/build e oxlint passaram.
- Chrome: usuário sem análises visualizou 8 casos oficiais; fluxo validado em 1440×1000 e 390×844, sem overflow ou novos erros de console.

## Checagem de rastreabilidade

| Tarefa | Dependência declarada | Diagrama | Status |
|---|---|---|---|
| T1 | nenhuma | início | ok |
| T2 | T1 | T1 → T2 | ok |
| T3 | T2 | T2 → T3 | ok |
| T4 | T2 | T2 → T4 | ok |
| T5 | T1, T4 | T1/T4 → T5 | ok |
| T6 | T3, T5 | T3/T5 → T6 | ok |

## Matriz de testes

| Tarefa | Camada | Teste | Gate |
|---|---|---|---|
| T1 | domínio Python | unitário | pytest focal |
| T2 | serviço/persistência Nest | unitário | Jest + build |
| T3 | React | build + UAT | frontend build |
| T4 | serviço/persistência Nest | unitário | Jest + build |
| T5 | integração de serviços | unitário/contrato | pytest + Jest + build |
| T6 | React | build + UAT | frontend build + Chrome |
