# MCP Server Design

**Spec:** `.specs/features/mcp-server/spec.md`
**Status:** Approved for execution

## Architecture

Revisão de decisão: o servidor MCP **não** mora dentro de `apps/ai-api`. Ele é um **app novo**, `apps/mcp-server` (Node/TypeScript), porque precisa consumir capacidades de ambos os serviços existentes (indexação no `ai-api`, análise de PR no Nest) e nenhum dos dois é dono natural do protocolo MCP. Colocá-lo num terceiro app evita inverter a regra de dependência atual — hoje só o Nest fala com o `ai-api`; com o gateway isolado, essa regra continua válida, e quem ganha um novo consumidor é a **API pública** de cada serviço, não o serviço em si.

Consequência prática: **`apps/ai-api` não precisa de nenhuma mudança**. As rotas REST de indexação (`/index/build`, `/index/status`, `/index/context`, `/index/repositories`) já existem e já são protegidas por `AI_SERVICE_TOKEN` (`ServiceAuthentication` middleware) — o `mcp-server` vira só mais um portador desse segredo, do mesmo jeito que o Nest já é hoje.

```
Cliente MCP (Claude Code/Desktop, Cursor, ...)
        │  HTTP/SSE (Streamable HTTP), Authorization: Bearer mcp_xxx
        ▼
apps/mcp-server  (Node/TS, app novo, infra própria: processo/porta/env)
        │
        ├─ tools de índice ──► apps/ai-api  /index/*  (Bearer AI_SERVICE_TOKEN, já existe, sem mudança)
        │
        ├─ introspecção     ──► apps/backend  POST /internal/mcp-tokens/introspect  (Bearer AI_SERVICE_TOKEN, novo)
        │                        devolve { userId, projectIds, scopes, actingJwt, actingJwtExpiresAt }
        │
        └─ tools de análise ──► apps/backend  rotas públicas de analyses, JÁ EXISTENTES
                                 (Authorization: Bearer <actingJwt>, mintado pelo Nest na introspecção)
```

### Por que `actingJwt` em vez de um guard dual-mode

Descartada a ideia anterior de um `McpTokenGuard` reconhecendo `mcp_` vs JWT nos controllers públicos do Nest. Em vez disso, o endpoint de introspecção — que já precisa existir para resolver `token MCP → userId/projectIds` — também **minta um JWT de ação de curta duração** (2 min) com o mesmo shape que `JwtAccessGuard` já valida hoje. Resultado: `AnalysesController`/`AnalysesService` **não mudam absolutamente nada**; continuam vendo um JWT normal, de um "login" de 2 minutos que o Nest emitiu para si mesmo em nome do dono do token MCP. Menos superfície nova em código que já tem RLS/ownership correto.

## Components

### `apps/mcp-server` (app novo — Node/TypeScript)

Estrutura sugerida (espelhando o padrão de módulos do Nest, mas como app HTTP simples — Fastify/Express + SDK oficial `@modelcontextprotocol/sdk`):

```
apps/mcp-server/
├── src/
│   ├── main.ts                  # bootstrap HTTP, monta transporte Streamable HTTP em /mcp
│   ├── config.ts                # env: AI_API_URL, BACKEND_URL, AI_SERVICE_TOKEN, PORT
│   ├── auth/
│   │   ├── mcp-auth.middleware.ts   # extrai Bearer do cliente, chama introspect, injeta McpPrincipal
│   │   └── introspect-client.ts     # HTTP client p/ POST /internal/mcp-tokens/introspect, cache 30s em memória
│   ├── tools/
│   │   ├── index-tools.ts       # index_repository, get_index_status, get_related_context → chama ai-api
│   │   └── analysis-tools.ts    # run_pr_analysis, get_analysis → chama Nest com actingJwt
│   └── clients/
│       ├── ai-api.client.ts     # thin HTTP client p/ apps/ai-api (Bearer AI_SERVICE_TOKEN)
│       └── backend.client.ts    # thin HTTP client p/ apps/backend (Bearer actingJwt por chamada)
├── package.json
└── tsconfig.json
```

- **Infra própria**: processo Node independente, porta própria (ex.: 3100), `AI_SERVICE_TOKEN` como env compartilhado com os outros dois apps, sem banco de dados próprio — introspecção cacheada em memória (LRU + TTL), sem Redis dedicado no v1.
- **Sem estado persistente**: `mcp-server` não guarda token MCP, não guarda resultado de análise — é gateway puro. Se cair e subir de novo, não perde nada.

### Nest: módulo `mcp-tokens/` (novo)

- `mcp-token.entity.ts` — `id, userId, tokenHash, projectIds[], scopes[], createdAt, expiresAt, revokedAt`.
- `mcp-tokens.service.ts` — emissão (token opaco `mcp_...`, hash com salt persistido), revogação, e a lógica de introspecção (valida hash, checa `revokedAt`/`expiresAt`, minta `actingJwt` via o mesmo `JwtService` que a sessão web já usa).
- `mcp-tokens.controller.ts` — `POST /mcp-tokens` (cria, protegido por JWT de sessão normal), `DELETE /mcp-tokens/:id`, `GET /mcp-tokens` (lista do usuário logado).
- `POST /internal/mcp-tokens/introspect` — protegido pelo mesmo guard de serviço que valida `AI_SERVICE_TOKEN` hoje (reaproveitar/extrair de `ServiceAuthentication` equivalente do lado Nest, se existir, ou criar `ServiceTokenGuard` simétrico ao do `ai-api`). Só o `mcp-server` chama esta rota.

### `apps/ai-api`

Nenhuma mudança. Rotas de índice reaproveitadas como estão.

## Data Contract

### `POST /internal/mcp-tokens/introspect` (Nest, novo)

```http
POST /internal/mcp-tokens/introspect
Authorization: Bearer <AI_SERVICE_TOKEN>
{ "token": "mcp_..." }

200 {
  "userId": "uuid",
  "projectIds": ["uuid", "..."],
  "scopes": ["index:read", "index:write", "analyses:read", "analyses:write"],
  "actingJwt": "eyJ...",
  "actingJwtExpiresAt": "2026-09-16T12:02:00Z"
}
401 { "message": "invalid or expired" }
```

### Tool `index_repository` (mcp-server → ai-api, sem mudança no ai-api)

```json
{
  "name": "index_repository",
  "input": { "ownerId": "string", "repoId": "string", "sha": "string", "files": [{ "path": "string", "content": "string" }] },
  "output": { "indexId": "string", "indexedFiles": 0, "skippedFiles": 0, "reusedFiles": 0, "truncated": false, "durationMs": 0 }
}
```

`mcp-server` valida `ownerId`/`repoId` contra `principal.projectIds` **antes** de chamar `ai-api`; se fora de escopo, nem faz a requisição upstream.

### Tool `run_pr_analysis` (mcp-server → Nest, rota pública existente)

```json
{
  "name": "run_pr_analysis",
  "input": {
    "owner": "string", "repo": "string", "pullNumber": 0,
    "models": { "testReviewer": "string", "architectureReviewer": "string" },
    "impactScope": { "mode": "repository" }
  },
  "output": { "analysisId": "string", "status": "running" }
}
```

`mcp-server` fixa `policies: { publish: "auto_safe" }` antes de repassar — via MCP não existe canal de aprovação humana no meio da execução.

### Tool `get_analysis`

```json
{
  "name": "get_analysis",
  "input": { "analysisId": "string" },
  "output": { "id": "string", "status": "running|completed|failed", "score": 0, "findings": [ ], "markdown": "string" }
}
```

## Security & Isolation

- Token MCP é entidade própria (não é PAT do GitHub nem JWT de sessão); revogar um não afeta o outro.
- Apenas hash do token é persistido no Nest; valor em claro só existe na resposta de criação.
- `actingJwt` tem TTL de 2 minutos, escopo idêntico ao de um JWT de sessão normal — se vazar, janela de exposição é curta e ele não é reutilizável fora desse tempo.
- `mcp-server` fail-closed: qualquer erro/timeout na introspecção → 401 pro cliente MCP, nunca assume acesso liberado.
- **Correção pós-implementação (`projectIds` não é tecnicamente aplicável no v1):** verificado durante a implementação que `ownerId` nas rotas `/index/*` do `ai-api` é literalmente o `userId` do usuário Cast (ver `apps/backend/src/modules/repositories/indexing/index.processor.ts`: `ownerId: job.data.userId`) — `ai-api` não tem noção de "projeto". E `actingJwt` mintado na introspecção é um JWT de usuário real e completo (mesmo formato que `JwtAccessGuard` já aceita em qualquer rota) — não existe hoje um jeito de restringi-lo a um subconjunto de projetos sem inventar um novo formato de claim e um guard extra nos endpoints de `analyses`. Dado isso, o escopo real e verificável no v1 é:
  - Tools de índice: `mcp-server` rejeita a chamada se `input.ownerId !== principal.userId` (não há checagem de `projectIds`, porque não há "projeto" do lado do `ai-api`).
  - Tools de análise: o `actingJwt` JÁ É a identidade completa de `principal.userId` no Nest — o RLS/ownership existente em `AnalysesService` aplica exatamente como aplicaria numa sessão web normal desse mesmo usuário. Nenhuma checagem adicional de escopo é necessária ou possível no `mcp-server` para essas tools.
  - A coluna `project_ids` em `mcp_tokens` continua existindo e é devolvida em `GET /mcp-tokens` (metadado informativo sobre a intenção do token), mas **não é aplicada como restrição em nenhum lugar no v1**. Isso é uma lacuna conhecida e documentada, não um bug silencioso — ficar por trás dela seria fingir uma garantia de isolamento por projeto que o sistema não entrega hoje. V2 exigiria: `ai-api` aprender o conceito de projeto (nova chamada ao Nest pra resolver quais `repoId` pertencem a um `projectId`) e um `actingJwt` restrito com claim de escopo + guard novo nos endpoints de `analyses`.
- `get_analysis` retorna 404 (não 403) pra recurso fora de escopo, mesmo padrão do resto da API.
- Rate limit dedicado no `mcp-server` (throttle por token MCP), já que é superfície nova exposta à internet — não depende do throttle existente do Nest (`/auth/validate`).

## Decisions

- **App novo em vez de módulo dentro de `ai-api` (revisão da decisão anterior):** o servidor MCP precisa falar com os dois serviços; embutir em qualquer um dos dois criava uma dependência cruzada nova (Python→Nest) e misturava protocolo de gateway com lógica de domínio. Um terceiro app mantém `ai-api` e Nest com a mesma regra de dependência de hoje, cada um só ganha "mais um cliente HTTP".
- **`ai-api` sem nenhuma mudança:** as rotas de índice já são um contrato de serviço estável (`AI_SERVICE_TOKEN`); não há necessidade de tocar nesse código para expor as mesmas capacidades a um novo consumidor.
- **`actingJwt` em vez de guard dual-mode no Nest:** menos mudança em código com RLS já correto (`AnalysesController`/`Service`); o "novo" fica isolado no módulo `mcp-tokens/`.
- **Linguagem do `mcp-server`: Node/TypeScript** — reaproveita SDK oficial MCP em TS e fica no mesmo ecossistema do Nest (mesmo `npm`, mesma esteira de CI/lint do resto do monorepo JS).
- **Sem banco/estado próprio no v1:** gateway é stateless; toda persistência (tokens, análises, grafo) já mora nos dois serviços de origem.
- **HITL fica fora do v1** (mantido da versão anterior do design): approve/resume dependem de humano síncrono na run; protocolo MCP não tem canal maduro pra isso ainda.

## Resolved Decisions

1. **TTL do token MCP:** 7 dias por padrão, configurável na criação (`expiresAt` opcional no `POST /mcp-tokens`, default `now()+7d`).
2. **Scopes:** sem granularidade no v1. Token = acesso total (index + analyses, read + write) aos `projectIds` associados. Campo `scopes[]` na entity fica reservado pra v2, introspecção sempre devolve `["index:read","index:write","analyses:read","analyses:write"]` fixo enquanto não houver granularidade real.
3. **Rate limit:** os dois — por token MCP e por IP — no `mcp-server`. Sem número específico pedido; usar defaults conservadores no primeiro corte (ex.: `ThrottlerModule`-like, 60 req/min por token e 300 req/min por IP) e ajustar com uso real.
4. **Deploy:** `apps/mcp-server` entra no `docker-compose.yml` como serviço próprio (Dockerfile + healthcheck), mesmo padrão de container que `postgres`/`redis`/`neo4j` já seguem — diferente de Nest/`ai-api` hoje, que rodam fora do compose. Isso é uma escolha deliberada só pro app novo, não retroage nos outros dois.
