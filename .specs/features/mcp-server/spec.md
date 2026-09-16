# MCP Server Specification

## Problem Statement

Hoje as capacidades do Cast (indexação de repositório via `code_graph`, análise de PR via `analyses`/pipeline de agentes) só são acessíveis pelo frontend web, via REST/WebSocket autenticado com JWT de usuário. Ferramentas externas baseadas em LLM (Claude Code, Claude Desktop, Cursor, outros clientes MCP) não têm como consultar o grafo de código de um repositório já indexado nem disparar/consultar uma análise de PR sem passar pela UI. O produto precisa expor um subconjunto dessas capacidades via **Model Context Protocol (MCP)**, com autenticação própria, para que esses clientes usem o Cast como fonte de contexto e ferramenta de review diretamente do fluxo de trabalho do desenvolvedor.

## Decisions (from discuss)

| Decisão | Escolha | Racional |
| --- | --- | --- |
| Onde o servidor MCP mora | App novo `apps/mcp-server` (Node/TypeScript) | Precisa consumir indexação (`ai-api`) e análise de PR (Nest); embutir num dos dois criaria dependência cruzada nova. Ver `design.md` |
| Transporte v1 | HTTP/SSE remoto (Streamable HTTP do MCP spec) | Serve o time inteiro sem instalação/config local; multi-usuário desde o início |
| Escopo de tools v1 | Indexação de repositório (`code_graph`) + Análise de PR (`analyses`) | Maior valor imediato; chat e benchmarks ficam para v2 |
| Modelo de auth | Token MCP dedicado (não reaproveita PAT do GitHub nem JWT de sessão) | Escopo restrito e revogável independente das credenciais do GitHub; permite rotação sem invalidar sessão web |

## Goals

- Expor um endpoint MCP HTTP/SSE em `apps/ai-api` que um cliente MCP (Claude Code, Claude Desktop, etc.) consiga configurar com uma URL + token.
- Permitir, via tools MCP, indexar um repositório e consultar status/contexto do grafo já indexado.
- Permitir, via tools MCP, disparar uma análise de PR (modo automático, sem HITL interativo) e consultar seu resultado/findings.
- Emitir e revogar tokens MCP dedicados, escopados a um usuário + um conjunto de projetos/repositórios.
- Respeitar o isolamento de dados (RLS) já existente: um token MCP nunca deve enxergar dados de outro tenant/projeto fora do seu escopo.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Transporte stdio | v1 é só remoto; stdio fica para quando houver demanda de uso 100% local |
| Tools de chat com repositório (`chat` module) | Fica para v2, após validar indexação + PR analysis |
| Tools de benchmarks/architecture-maps | Fica para v2 |
| HITL interativo via MCP (approve/resume de gates) | Analises via MCP rodam só com `policies: auto`/`auto_safe`; aprovação manual continua exclusiva da UI web |
| Reaproveitar PAT do GitHub como credencial MCP | Token MCP é entidade própria; o PAT do GitHub continua vivendo só no fluxo web existente |
| Emissão de tokens via MCP | Tokens são emitidos/revogados pela UI/API do Nest, não por uma tool MCP |

## User Stories

### P1: Indexar um repositório via MCP

Como usuário de um cliente MCP, quero indexar um repositório do Cast para que o agente tenha contexto estrutural (grafo de símbolos/dependências) durante a conversa.

Acceptance criteria:

1. WHEN o cliente MCP chama a tool `index_repository` com `ownerId`, `repoId`, `sha` e a lista de arquivos THEN o sistema SHALL disparar a indexação incremental existente (`build_incremental`) e retornar `indexId`, contagem de arquivos indexados/reaproveitados/pulados e duração.
2. WHEN o `ownerId` informado é diferente do usuário dono do token MCP THEN o sistema SHALL responder erro de autorização sem tocar no Neo4j/Redis daquele repo. (Nota pós-implementação: `ownerId` no `ai-api` é o `userId` do Cast, não um `projectId` — ver `design.md` "Correção pós-implementação". `projectIds` do token é metadado no v1, não restrição aplicada.)
3. WHEN já existe indexação em andamento para o mesmo `repoId`+`ownerId` THEN o sistema SHALL responder conflito (409) em vez de enfileirar uma segunda indexação concorrente.

### P1: Consultar status e contexto do índice

Como usuário de um cliente MCP, quero consultar se um repositório já foi indexado e puxar contexto relacionado a um conjunto de arquivos alterados.

Acceptance criteria:

1. WHEN o cliente MCP chama `get_index_status` com `ownerId`+`repoId` THEN o sistema SHALL retornar se há índice e qual o `sha` mais recente, restrito ao escopo do token.
2. WHEN o cliente MCP chama `get_related_context` com `ownerId`, `repoId`, `sha` e `changedFiles` THEN o sistema SHALL retornar o contexto relacionado (mesmo formato de `assemble_related_context`) respeitando o `tokenBudget`.
3. WHEN o repositório pedido nunca foi indexado THEN o sistema SHALL retornar uma resposta vazia e explícita, não erro 500.

### P1: Disparar análise de PR via MCP

Como usuário de um cliente MCP, quero disparar a análise automática de uma PR do Cast e acompanhar o resultado sem abrir a UI web.

Acceptance criteria:

1. WHEN o cliente MCP chama `run_pr_analysis` com `owner`, `repo`, `pullNumber` e `models` THEN o sistema SHALL encaminhar a chamada ao endpoint existente `POST repositories/:repo/pulls/:pullNumber/analyses` no Nest, usando `policies` fixadas em modo automático (`auto`/`auto_safe`), e retornar o `analysisId`.
2. WHEN o token MCP não tem escopo para o repositório informado THEN o sistema SHALL recusar o encaminhamento ao Nest.
3. WHEN a chamada ao Nest falha (GitHub PAT inválido, LLM key ausente, etc.) THEN a tool SHALL retornar o motivo de erro original, não uma mensagem genérica.

### P1: Consultar resultado de uma análise

Como usuário de um cliente MCP, quero consultar o status e os findings de uma análise já disparada.

Acceptance criteria:

1. WHEN o cliente MCP chama `get_analysis` com `analysisId` THEN o sistema SHALL retornar o mesmo payload de `GET analyses/:id`, escopado ao dono do token.
2. WHEN a análise ainda está em execução THEN a tool SHALL retornar o status atual sem bloquear a chamada MCP esperando conclusão.
3. WHEN o `analysisId` pertence a outro usuário/projeto fora do escopo do token THEN o sistema SHALL retornar 404 (não 403, para não vazar existência do recurso).

### P2: Gerenciar tokens MCP

Como usuário autenticado na UI web, quero criar e revogar tokens MCP escopados a projetos específicos.

Acceptance criteria:

1. WHEN um usuário cria um token MCP escolhendo um ou mais projetos THEN o sistema SHALL gerar um token opaco, mostrado uma única vez, e persistir apenas seu hash.
2. WHEN um usuário revoga um token MCP THEN chamadas subsequentes com esse token SHALL falhar imediatamente (sem esperar expiração).
3. WHEN um token MCP expira (TTL configurável) THEN o sistema SHALL recusar seu uso e sinalizar expiração distinta de revogação.

## Edge Cases

- Cliente MCP chama uma tool sem token (`Authorization` ausente) → erro de autenticação, não crash do servidor MCP.
- Token válido mas sem nenhum projeto associado → todas as tools de dados retornam vazio/403 coerente, não erro interno.
- `run_pr_analysis` chamado duas vezes para a mesma PR em paralelo → mesmo comportamento de idempotência/conflito que a rota Nest já implementa hoje.
- Payload de indexação excede `MAX_REQUEST_BYTES`/`CODE_GRAPH_MAX_FILES` → mesma resposta de limite já aplicada pelas rotas REST existentes, reaproveitada pela tool.
- Introspecção do token MCP falha por indisponibilidade do Nest → tool responde erro de upstream, nunca assume acesso liberado por padrão (fail closed).

## Requirement Traceability

| ID | Requirement | Status |
| --- | --- | --- |
| MCP-01 | Tool `index_repository` reaproveita `build_incremental` com checagem de escopo | Planned |
| MCP-02 | Tool `get_index_status` / `get_related_context` respeitam escopo do token | Planned |
| MCP-03 | Tool `run_pr_analysis` encaminha para Nest com policies automáticas | Planned |
| MCP-04 | Tool `get_analysis` espelha `GET analyses/:id` escopado ao dono | Planned |
| MCP-05 | Emissão/revogação de token MCP (hash persistido, TTL, revogação imediata) | Planned |
| MCP-06 | Fail-closed quando introspecção de token falha ou está fora de escopo | Planned |
