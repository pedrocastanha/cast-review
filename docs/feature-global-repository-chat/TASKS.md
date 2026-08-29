# Chat Global e Chat por Repositório — Tarefas

**Status:** Em execução

**PRD:** [PRD.md](./PRD.md)

**SDD:** [SDD.md](./SDD.md)

## Dependências

`T1 → T2 → T3 → T4 → T5 → T6`

As tarefas são sequenciais porque backend, AI API e frontend compartilham contratos. Testes unitários são escritos antes da implementação de cada contrato e não são alterados durante a fase verde.

## T1 — Catálogo de índices e filtro de repositórios

**Requisitos:** GRC-01, GRC-03, GRC-N03

**Entregas:** listar índices paginados na AI API; intersectar índices com repositórios GitHub autorizados; aceitar `GET /repositories?indexed=true` sem alterar a resposta padrão.

**Testes:** pytest unitário e Jest unitário.

**Gate:** `cd apps/ai-api && pytest -m "not integration"`; `cd apps/backend && npm run test`.

**Concluído quando:** o filtro retorna apenas índices consultáveis, mantém stale e a chamada sem filtro preserva o comportamento existente.

## T2 — Threads globais, grants e auditoria de modelo

**Requisitos:** GRC-02, GRC-04, GRC-06, GRC-08, GRC-N02, GRC-N04

**Entregas:** contratos `global|repository`; listagem sem threads de projeto; grant interno assinado e endpoints de catálogo; validação de `repositoryHint`; migration e persistência de modelo.

**Testes:** Jest unitário para DTOs, serviço, grant, catálogo e persistência.

**Gate:** `cd apps/backend && npm run test`.

**Concluído quando:** global não congela catálogo, repository congela SHA, o grant não vaza para a resposta pública e o modelo reaparece ao reabrir a thread.

## T3 — Agente global e engenharia de contexto

**Requisitos:** GRC-03, GRC-04, GRC-10, GRC-N01, GRC-N02

**Entregas:** cliente de catálogo; ferramenta `list_indexed_repositories`; carga preguiçosa; `repoId` obrigatório no modo global; cache LRU de três workspaces; system prompt operacional sem catálogo embutido.

**Testes:** pytest unitário para prompt, catálogo, autorização, lazy loading, limites e execução com dois repositórios.

**Gate:** `cd apps/ai-api && pytest -m "not integration"`.

**Concluído quando:** a ferramenta descobre índices novos sob demanda, duas bases podem ser investigadas na mesma mensagem e nenhum catálogo completo entra no prompt.

## T4 — Navegação e compositor

**Requisitos:** GRC-02, GRC-05, GRC-06, GRC-07

**Entregas:** `/chat` global; aba `/repos/:owner/:repo/chat`; remoção do seletor de projeto; autocomplete `/`; modelo editável com default `gpt-5.4-mini`; mesmo default em Analysis.

**Testes:** testes Node das funções puras do parser de repositório; typecheck e lint.

**Gate:** `cd apps/frontend && npm run test && npx tsc -b && npx oxlint`.

**Concluído quando:** as duas superfícies ficam isoladas, o autocomplete é navegável por teclado e somente a pista selecionada é enviada.

## T5 — Evidências e estados do chat

**Requisitos:** GRC-08, GRC-09

**Entregas:** disclosure fechado inicialmente; agrupamento por repositório/arquivo; links de grafo/GitHub; modelo e uso por resposta; estados vazio, erro e índice indisponível coerentes.

**Testes:** typecheck, lint e inspeção determinística de anti-padrões.

**Gate:** `cd apps/frontend && npx tsc -b && npx oxlint`.

**Concluído quando:** contador permanece visível, o disclosure funciona por teclado e as evidências não inventam destinos.

## T6 — Integração e UAT real

**Requisitos:** todos

**Entregas:** aplicar migration; gates completos; login no Chrome; chat por repositório atual; chat global consultando dois repositórios; seleção `/`; troca de modelo; expansão de evidências; screenshots; crítica visual e correção dos achados relevantes.

**Testes:** backend, AI API, frontend e Chrome/Playwright.

**Gate:** todos os comandos documentados no SDD, seguidos de UAT real.

**Concluído quando:** os fluxos principais funcionam com dados reais, não há erro relevante no console/rede e os screenshots demonstram respostas, tools e evidências.
