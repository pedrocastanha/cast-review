# Cross-Repo Core Specification

**Status:** Implemented and validated  
**Date:** 2026-08-23  
**PRD:** `docs/feature-cross-repo-impact/PRD.md`

## Problem Statement

O Cast indexa e visualiza repositórios isoladamente. Ele não possui uma entidade de projeto que agrupe vários repositórios nem uma relação verificável entre um endpoint fornecido por um serviço e a chamada que o consome em outro repositório.

## Goals

- Criar e editar projetos compostos por repositórios GitHub autorizados.
- Indexar os membros de um projeto usando a fila existente.
- Extrair providers e consumers HTTP da stack dogfood.
- Materializar e consultar relações cross-repo no Neo4j.
- Visualizar relações agregadas e suas evidências na UI.
- Preservar isolamento por usuário, projeto, repositório e SHA.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Chat, memória e LLM | Release 2 |
| Toggle contextual | Release 3 |
| Roles, Feature Cards e Kanban | Release 4 |
| Matching semântico | O MVP deve provar relações deterministicamente |
| Todos os frameworks | Primeiro slice cobre a stack real do Cast |
| Contract drift completo | Depende do núcleo cross-repo estável |

## User Stories

### P1: Gerenciar projeto multi-repositório

**User Story:** Como usuário autenticado, quero criar e editar um projeto com repositórios GitHub acessíveis para representar meu sistema.

**Acceptance Criteria:**

1. WHEN o usuário criar um projeto THEN o sistema SHALL validar nome e ao menos um repositório autorizado.
2. WHEN um full name não estiver entre os repositórios acessíveis THEN o sistema SHALL rejeitar toda a operação.
3. WHEN o usuário listar ou abrir projetos THEN o sistema SHALL retornar somente projetos próprios.
4. WHEN o usuário editar membros THEN o sistema SHALL substituir a associação atomicamente.

### P1: Indexar projeto

**User Story:** Como usuário, quero indexar todos os membros e acompanhar seus estados separadamente.

**Acceptance Criteria:**

1. WHEN a indexação for solicitada THEN o sistema SHALL enfileirar um job por membro.
2. WHEN o status for consultado THEN o sistema SHALL retornar status, SHA, stale e progresso de cada membro.
3. WHEN um membro falhar THEN os demais SHALL continuar consultáveis.

### P1: Correlacionar endpoints

**User Story:** Como engenheiro, quero ver qual repositório consome endpoints de outro e por quê.

**Acceptance Criteria:**

1. WHEN NestJS ou FastAPI declarar uma rota suportada THEN o índice SHALL persistir um provider versionado.
2. WHEN `request`, `fetch` ou Axios simples chamar uma rota suportada THEN o índice SHALL persistir um consumer versionado.
3. WHEN método e rota normalizada coincidirem entre repositórios diferentes THEN o Neo4j SHALL materializar `CONSUMES` com evidências dos dois lados.
4. WHEN um repositório for reindexado THEN seus endpoints antigos e links dependentes SHALL ser removidos sem apagar artefatos de outro repositório.
5. WHEN múltiplos providers coincidirem THEN cada candidato SHALL permanecer identificável na resposta.

### P1: Visualizar grafo do projeto

**User Story:** Como usuário, quero visualizar componentes e abrir a evidência por trás de cada relação.

**Acceptance Criteria:**

1. WHEN a página abrir THEN todos os repositórios membros SHALL aparecer, inclusive não indexados.
2. WHEN relações existirem THEN a UI SHALL desenhar consumidor → provedor com quantidade de endpoints.
3. WHEN uma relação for selecionada THEN SHALL mostrar método, rota, paths, linhas, SHAs e confiança.
4. WHEN não houver relações THEN a UI SHALL explicar como indexar ou por que não houve match.
5. WHEN a viewport mudar THEN ações críticas e evidências SHALL continuar acessíveis.

## Edge Cases

- Projeto com repositório sem índice.
- Provider e consumer no mesmo repositório não geram link cross-repo.
- Rotas com `:id`, `{id}` e `${id}` normalizam para a mesma identidade.
- Métodos diferentes na mesma rota não casam.
- Reindexação troca o SHA atual e invalida links antigos.
- Projeto acessado por outro usuário retorna not found.

## Requirement Traceability

| Requirement ID | Story | Status |
| --- | --- | --- |
| XREPO-01 | Gerenciar projeto | Complete |
| XREPO-02 | Autorização de repositórios | Complete |
| XREPO-03 | Indexação coordenada | Complete |
| XREPO-04 | Extração de providers | Complete |
| XREPO-05 | Extração de consumers | Complete |
| XREPO-06 | Materialização Neo4j | Complete |
| XREPO-07 | Reindexação segura | Complete |
| XREPO-08 | Grafo agregado | Complete |
| XREPO-09 | Evidência na UI | Complete |
| XREPO-10 | Estados e responsividade | Complete |

## Success Criteria

- Baseline ampliada: backend 105 testes e AI API 205 testes continuam passando.
- Fixtures novas cobrem NestJS, FastAPI, request e normalização.
- O projeto dogfood pode ser criado e indexado pelo usuário `pedrocastanha`.
- Fluxo de criação, edição, indexação e grafo é validado no navegador.
