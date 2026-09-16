# Arquitetura — Servidor MCP (`apps/mcp-server`)

Documento de varredura do app novo `apps/mcp-server`, que expõe um subconjunto das capacidades do Cast (indexação de repositório e análise de PR) via **Model Context Protocol**.
Espelha `.specs/features/mcp-server/spec.md` e `.specs/features/mcp-server/design.md` — este documento descreve o sistema **como foi implementado**, incluindo a correção pós-implementação registrada no design (`ownerId` sem noção de projeto, `actingJwt` como identidade completa). Para o resto do backend (Nest + `ai-api`), ver `docs/ARCHITECTURE-backend.md`.

---

## 1. Visão em uma frase

Um app Node/TypeScript novo, stateless, expõe um endpoint MCP (Streamable HTTP) que autentica cada chamada trocando um **token MCP opaco** por um **JWT de ação de 2 minutos** via introspecção no Nest, e depois vira só um proxy fino: ferramentas de índice vão pro `ai-api` com o segredo de serviço já existente, ferramentas de análise vão pro Nest com esse JWT de curta duração, como se fosse uma sessão web normal do dono do token.

---

## 2. Fluxo (três pontas)

```
Cliente MCP (Claude Code/Desktop, Cursor, inspector, ...)
        │  HTTP POST/GET/DELETE /mcp, Authorization: Bearer mcp_xxx
        ▼
apps/mcp-server  (Node/TS — Express + @modelcontextprotocol/sdk, porta 3100)
        │
        │  1. mcp-auth.middleware extrai o Bearer e chama introspect-client
        │     POST /internal/mcp-tokens/introspect  (Bearer AI_SERVICE_TOKEN)
        │     ──────────────────────────────────────────────────────►  apps/backend (Nest)
        │     ◄──────────────────────────────────────────────────────
        │     { userId, projectIds, scopes, actingJwt, actingJwtExpiresAt }
        │     (cache em memória por MCP_TOKEN_CACHE_TTL_SECONDS, default 30s)
        │
        │  2. principal (userId + actingJwt) fica em AsyncLocalStorage
        │     (principal-context.ts) durante toda a chamada da tool
        │
        ├─ tools de índice (index_repository, get_index_status,
        │  get_related_context) — checam ownerId === principal.userId
        │  e chamam ──────────────────────────────────────────────►  apps/ai-api
        │            Authorization: Bearer AI_SERVICE_TOKEN            /index/*
        │            (rotas já existentes, SEM mudança)
        │
        └─ tools de análise (run_pr_analysis, get_analysis)
                   chamam ──────────────────────────────────────►  apps/backend (Nest)
                           Authorization: Bearer <actingJwt>          rotas públicas
                           (mesmo JwtAccessGuard de sempre)           de /analyses
```

`apps/mcp-server` não tem banco próprio: sessões MCP (Streamable HTTP) vivem num `Map<sessionId, transport>` em memória; introspecção é cacheada em memória; nada é persistido. Se o processo reiniciar, perde sessões abertas e cache — não perde dado nenhum, porque não é dono de dado nenhum.

---

## 3. As 5 tools

Registradas em `src/tools/index-tools.ts` e `src/tools/analysis-tools.ts`, montadas em `src/mcp/server.ts`:

| Tool | O que faz |
| --- | --- |
| `index_repository` | Dispara indexação incremental (`build_incremental` do `ai-api`) para `ownerId`/`repoId`/`sha`, retorna `indexId` e contagens de arquivos indexados/reaproveitados/pulados |
| `get_index_status` | Consulta se um repositório já foi indexado e qual o `sha` mais recente conhecido |
| `get_related_context` | Retorna o contexto de grafo relacionado a uma lista de `changedFiles`, respeitando `tokenBudget` opcional |
| `run_pr_analysis` | Encaminha para `POST repositories/:repo/pulls/:pullNumber/analyses` no Nest, fixando `policies.publish = "auto_safe"`; devolve `analysisId` assim que consegue lê-lo do início do stream SSE (sem esperar a análise terminar) |
| `get_analysis` | Espelha `GET analyses/:id`; erro upstream contendo `404` vira mensagem `"analysis not found"` em vez de vazar detalhe |

As duas tools de índice checam `ownerId === principal.userId` **antes** de chamar o `ai-api` (`isOwnerAuthorized` em `index-tools.ts`); se falhar, retornam `isError: true` sem tocar em Neo4j/Redis. As tools de análise não fazem checagem própria de escopo — ver seção 5.

---

## 4. Modelo de autenticação

- **Token MCP**: opaco, formato `mcp_<64 hex>` (`mcp-tokens.service.ts#issue`). Só o hash SHA-256 é persistido na tabela `mcp_tokens` (`tokenHash`); o valor cru só existe na resposta de `POST /mcp-tokens`, uma vez.
- **Introspecção**: `POST /internal/mcp-tokens/introspect` no Nest, protegida por `ServiceTokenGuard` (`apps/backend/src/shared/security/service-token.guard.ts`) — compara o `Authorization: Bearer <AI_SERVICE_TOKEN>` recebido com o env via `timingSafeEqual`, mesmo padrão que o `ai-api` já usa para suas próprias rotas de serviço. `mcp-tokens.service.ts#introspect` valida hash, `revokedAt` e `expiresAt < now()` e, se tudo ok, minta o `actingJwt`.
- **`actingJwt`**: JWT de 2 minutos (`expiresIn: '2m'`), assinado com o mesmo `jwtConfig.access.secret` (`JWT_ACCESS_SECRET`) e mesmo shape (`{ sub: userId }`) que o `JwtAccessGuard` da sessão web normal já valida. Não há guard novo nos controllers de `analyses` — eles continuam vendo um JWT de usuário comum.
- **Cache de introspecção**: `mcp-server` guarda o resultado em memória por `MCP_TOKEN_CACHE_TTL_SECONDS` (default 30s) para não bater no Nest a cada chamada de tool — revogação de token, porém, é sempre checada de novo pelo Nest no próximo round-trip de introspecção (não espera TTL de 7 dias nem o cache de 30s "esconder" a revogação para sempre).
- **Fail-closed**: qualquer erro/timeout na introspecção retorna 401 ao cliente MCP (`IntrospectionFailedError` em `introspect-client.ts`); nunca há acesso liberado por padrão.
- **Rate limit**: dois limitadores no próprio `mcp-server` (`src/rate-limit.ts`) — por token MCP e por IP — antes mesmo de chamar a introspecção, defaults de `RATE_LIMIT_PER_TOKEN_PER_MIN=60` e `RATE_LIMIT_PER_IP_PER_MIN=300`.

---

## 5. Limitação conhecida do v1 — escopo por `projectIds` não é aplicado

Registrado em `design.md` ("Correção pós-implementação") e reproduzido aqui porque é o ponto mais fácil de superestimar:

- **Tools de índice**: `ai-api` não tem noção de "projeto" — o `ownerId` das rotas `/index/*` é literalmente o `userId` do Cast (`index.processor.ts`: `ownerId: job.data.userId`). A única checagem real e aplicada é `input.ownerId === principal.userId`. Não existe filtragem por `projectIds`.
- **Tools de análise**: o `actingJwt` mintado na introspecção é a identidade **completa** de `principal.userId`, com o mesmo alcance de uma sessão web normal — o RLS/ownership que já existe em `AnalysesService` se aplica exatamente como se aplicaria numa sessão web. Não há (nem é possível, sem inventar claim de escopo + guard novo) restringir esse JWT a um subconjunto de projetos.
- A coluna `project_ids` em `mcp_tokens` continua existindo, é devolvida em `GET /mcp-tokens`, mas é **metadado informativo** sobre a intenção do token — não é uma restrição tecnicamente aplicada em lugar nenhum no v1. Isso é uma lacuna documentada, não um bug silencioso.
- Também fora do escopo do v1 (ver `spec.md`): transporte stdio, tools de chat com repositório, tools de benchmarks/architecture-maps, HITL interativo via MCP (analyses via MCP só rodam com `policies.publish: "auto_safe"`), granularidade de `scopes[]` (a introspecção sempre devolve os quatro scopes fixos `index:read`, `index:write`, `analyses:read`, `analyses:write`).

---

## 6. Dois bugs encontrados e corrigidos durante o T12 (validação end-to-end real)

O T12 rodou a cadeia inteira contra infra local real (Postgres/Redis/Neo4j/Nest/`ai-api`/`mcp-server`), com um token MCP real e chamadas de tool reais via o MCP inspector oficial. Dois bugs surgiram só nesse teste real (não em unit tests com mocks) e foram corrigidos no código:

1. `McpTokensModule` precisava importar `JwtModule.register({})` — sem isso, `JwtService` não estava disponível para injeção em `McpTokensService` e a introspecção quebrava em runtime.
2. `McpTokensService.issue()` precisava chamar `this.repository.create({...})` **antes** de `this.repository.save(...)` — passar um objeto plano direto pro `save()` não aciona a geração de `id` que `DefaultEntity` espera do TypeORM, então o token era salvo sem id.

Ambos já estão no código atual (`mcp-tokens.module.ts` importa `JwtModule.register({})`; `mcp-tokens.service.ts#issue` chama `create()` antes de `save()`).

> Nota de regressão encontrada ao rodar os gates desta task: o mock de `McpTokenRepository` em `mcp-tokens.service.spec.ts` não foi atualizado depois da correção #2 — ele não expõe `create()`, então `McpTokensService#issue` falha em 2 testes unitários com `TypeError: this.repository.create is not a function`, mesmo com o comportamento real (validado pelo T12) correto. É uma lacuna do teste, não do código de produção.

---

## 7. Como rodar local

`apps/backend` e `apps/ai-api` seguem exatamente as instruções já existentes em `docs/ARCHITECTURE-backend.md` (seção "Como rodar local") — não duplicado aqui.

### `apps/mcp-server`

```bash
cd apps/mcp-server
npm install
npm run build
npm test

# variáveis de ambiente (ver src/config.ts):
# PORT=3100                              (default)
# AI_API_URL=http://localhost:8000       (default)
# BACKEND_URL=http://localhost:3000      (default)
# AI_SERVICE_TOKEN=<mesmo valor usado pelo Nest e pelo ai-api>
# MCP_TOKEN_CACHE_TTL_SECONDS=30         (default)
# RATE_LIMIT_PER_TOKEN_PER_MIN=60        (default)
# RATE_LIMIT_PER_IP_PER_MIN=300          (default)

npm run start   # ou o comando de dev equivalente do package.json
# GET http://localhost:3100/health → { "status": "ok" }
```

`AI_API_URL`, `BACKEND_URL` e `AI_SERVICE_TOKEN` são obrigatórios quando `NODE_ENV=production`/`APP_ENV=production` (`requiredInProduction` em `config.ts`); em dev, caem nos defaults acima se não configurados.

No `docker-compose.yml` da raiz, `mcp-server` já entra como serviço próprio (`build.context: ./apps/mcp-server`, porta `3100:3100`, healthcheck em `/health`, `host.docker.internal` para falar com Nest/`ai-api` rodando fora do compose) — diferente do Nest e do `ai-api`, que hoje rodam fora do compose.

---

## 8. Como emitir um token MCP

Com uma sessão web normal (JWT de acesso do Nest) já em mãos:

```http
POST /mcp-tokens
Authorization: Bearer <jwt de sessão>
Content-Type: application/json

{
  "projectIds": ["<uuid-de-um-projeto>"],
  "expiresAt": "2026-10-01T00:00:00Z"   // opcional; default now()+7d
}
```

Resposta (`200`), token cru mostrado **uma única vez**:

```json
{
  "id": "uuid",
  "token": "mcp_<64 caracteres hex>",
  "expiresAt": "2026-10-01T00:00:00.000Z"
}
```

Guarde o valor de `token` — só o hash fica persistido; não é possível recuperá-lo depois. Use-o como `Authorization: Bearer mcp_...` ao configurar o cliente MCP apontando para `http://localhost:3100/mcp`. Para revogar, `DELETE /mcp-tokens/:id` (mesmo JWT de sessão, escopado ao dono do token) — a próxima introspecção já falha, sem esperar TTL.
