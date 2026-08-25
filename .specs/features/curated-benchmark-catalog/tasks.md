# Curated Benchmark Catalog Tasks

**Status:** Complete

## Execution Plan

T1 → T2 → T3 → T4 → T5 → T6

### T1 — Contrato de fixture e testes imutáveis

- Requirement: CBC-02, CBC-03
- Entrega: testes de contagem, unicidade, origem, hash e estrutura do snapshot.
- Gate: Jest do módulo benchmarks.

### T2 — Gerador e pacote v1

- Depends on: T1
- Requirement: CBC-01, CBC-02, CBC-03
- Entrega: gerador de manutenção e oito fixtures materializados.
- Gate: testes T1 e build backend.

### T3 — Migration idempotente

- Depends on: T2
- Requirement: CBC-04, CBC-05
- Entrega: índice de slug oficial e carga dos fixtures.
- Gate: migration run duas vezes e consulta SQL.

### T4 — Metadados do catálogo na API/UI

- Depends on: T3
- Requirement: CBC-03, CBC-05
- Entrega: tipos, agrupamento visual e auditoria da origem.
- Gate: builds backend/frontend.

### T5 — Gates automatizados

- Depends on: T4
- Requirement: CBC-06
- Entrega: suites relevantes, builds, lint direcionado e diff check.

### T6 — UAT no Chrome e documentação

- Depends on: T5
- Requirement: CBC-01 a CBC-06
- Entrega: catálogo validado em desktop/mobile e PRD/SDD atualizados.

## Validation

| Task | Granular | Dependencies match | Tests co-located |
| --- | --- | --- | --- |
| T1 | ✅ | ✅ | ✅ |
| T2 | ✅ | ✅ | ✅ |
| T3 | ✅ | ✅ | n/a |
| T4 | ✅ | ✅ | build/UAT |
| T5 | ✅ | ✅ | gate |
| T6 | ✅ | ✅ | UAT |

## Validation Result

- Fixtures: 8 casos, 8 slugs e 8 IDs únicos; regeneração produziu o mesmo SHA-256 do módulo.
- Migration: primeira execução inseriu 8 casos; segunda execução retornou `No migrations are pending`; 8 slugs distintos permaneceram.
- Backend: 15 suites e 96 testes passaram; build passou.
- Frontend: build e oxlint passaram; permanece apenas o aviso preexistente em `AuthContext.tsx`.
- Chrome: usuário novo visualizou 8 oficiais e 0 privados em 1440×1000 e 390×844; `scrollWidth` móvel ficou igual à viewport.
