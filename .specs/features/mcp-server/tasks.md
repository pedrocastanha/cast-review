# MCP Server Tasks

**Design:** `.specs/features/mcp-server/design.md`
**Status:** Complete (T1-T14 implemented and gate-checked; T15 UAT run — see Validation Result. `run_pr_analysis` against a real GitHub PR remains blocked on real GitHub PAT + LLM API key, not available in this environment — documented as a follow-up, not faked.)

## Execution Plan

Duas trilhas independentes convergem em T7 (`apps/mcp-server` só existe fisicamente antes disso; o lado Nest só precisa existir como contrato).

```
Trilha Nest:        T1 → T2 → T3
                          └──► T4 ──┐
Trilha mcp-server:  T5 → T6 ────────┼──► T7 → T8 [P com T7 após T5]
                                    │        │
                                    └────────┴──► T9, T10 [P entre si] → T11 → T12 → T13 → T14 → T15
```

- T1–T3 (Nest) e T5–T6 (mcp-server) podem rodar em paralelo — apps diferentes, sem arquivo compartilhado.
- T9 (tools de índice) e T10 (tools de análise) podem rodar em paralelo — arquivos distintos (`index-tools.ts` vs `analysis-tools.ts`), ambos só leem `McpPrincipal` já pronto de T7.

### T1 — Entity + migration `mcp_tokens` (Nest)

- Requirement: MCP-05
- Entrega: `mcp-token.entity.ts` (`id, userId, tokenHash, projectIds jsonb, createdAt, expiresAt, revokedAt`), migration com índice único em `tokenHash`.
- Gate: migration roda limpo (up/down), testes de entity.

### T2 — Serviço de emissão/revogação/introspecção (Nest)

- Depends on: T1
- Requirement: MCP-05, MCP-06
- Entrega: `mcp-tokens.service.ts` — gera token opaco `mcp_<32 bytes hex>`, persiste só hash (mesmo padrão de hashing do `auth.service.ts`), `expiresAt` default `now()+7d` configurável na criação, `revoke()` seta `revokedAt`, `introspect()` valida hash+revogação+expiração e minta `actingJwt` (2 min, via `JwtService` já usado na sessão web) com scopes fixos `["index:read","index:write","analyses:read","analyses:write"]`.
- Gate: `mcp-tokens.service.spec.ts` — emissão só mostra token cru uma vez; token revogado falha introspecção; token expirado falha introspecção; token válido devolve `actingJwt` decodificável pelo `JwtAccessGuard` existente.

### T3 — Controller público `/mcp-tokens` (Nest)

- Depends on: T2
- Requirement: MCP-05
- Entrega: `POST /mcp-tokens` (body: `projectIds[]`, `expiresAt?`), `GET /mcp-tokens`, `DELETE /mcp-tokens/:id` — todas atrás do `JwtAccessGuard` normal, escopadas a `CurrentUser`.
- Gate: controller spec — usuário só lista/revoga os próprios tokens; criar sem `projectIds` válidos falha validação.

### T4 — Rota interna `/internal/mcp-tokens/introspect` (Nest)

- Depends on: T2
- Requirement: MCP-06
- Entrega: guard de serviço validando `AI_SERVICE_TOKEN` (simétrico ao `ServiceAuthentication` do `ai-api`, `hmac.compare_digest`-equivalente em TS), rota chama `mcp-tokens.service.introspect()`.
- Gate: spec cobrindo: sem `AI_SERVICE_TOKEN` → 401; `AI_SERVICE_TOKEN` errado → 401; token MCP inválido/revogado/expirado → 401 com corpo distinguindo motivo; token válido → 200 com `actingJwt`.

### T5 — Scaffold `apps/mcp-server` [P com T1]

- Requirement: infra (base para MCP-01..MCP-06)
- Entrega: `package.json`, `tsconfig.json`, `src/main.ts` com HTTP server (Fastify) + `GET /health`, `src/config.ts` lendo `AI_API_URL`, `BACKEND_URL`, `AI_SERVICE_TOKEN`, `PORT`, `MCP_TOKEN_CACHE_TTL_SECONDS`.
- Gate: `npm run build` no novo app; `GET /health` responde 200 local.

### T6 — Transporte MCP (Streamable HTTP)

- Depends on: T5
- Requirement: MCP-01..MCP-04
- Entrega: instala `@modelcontextprotocol/sdk`, monta endpoint `/mcp` com transporte Streamable HTTP, registry de tools vazio, capability negotiation funcionando.
- Gate: `npx @modelcontextprotocol/inspector` conecta em `http://localhost:<porta>/mcp` e lista 0 tools sem erro de handshake.

### T7 — Auth middleware do mcp-server

- Depends on: T6, T4
- Requirement: MCP-06
- Entrega: `auth/introspect-client.ts` (chama T4, cache LRU 30s por token), `auth/mcp-auth.middleware.ts` extrai `Authorization: Bearer`, injeta `McpPrincipal { userId, projectIds, actingJwt, actingJwtExpiresAt }` no contexto da chamada MCP. Fail-closed: timeout/erro de rede na introspecção → 401.
- Gate: testes unitários — sem header → 401; introspecção 401 → 401 propagado; introspecção OK → principal injetado e cacheado por 30s (segunda chamada não repete a introspecção).

### T8 — Clients HTTP (ai-api, backend) [P com T7 após T5]

- Depends on: T5
- Requirement: MCP-01, MCP-03
- Entrega: `clients/ai-api.client.ts` (Bearer `AI_SERVICE_TOKEN` fixo, chama `/index/*`), `clients/backend.client.ts` (Bearer `actingJwt` recebido por chamada, chama rotas de `analyses`).
- Gate: testes unitários com mock HTTP (msw/nock) — client propaga status/erro upstream sem reformatar mensagem.

### T9 — Tools de índice [P com T10]

- Depends on: T7, T8
- Requirement: MCP-01, MCP-02
- Entrega: `tools/index-tools.ts` — `index_repository`, `get_index_status`, `get_related_context`; checa `ownerId`/`repoId` ∈ `principal.projectIds` **antes** de chamar `ai-api`; erros upstream (409 conflito de lock, payload grande) repassados como estão.
- Gate: testes unitários — fora de escopo não gera chamada HTTP upstream (mock não invocado); conflito 409 upstream vira erro de tool, não crash; repositório nunca indexado devolve resposta vazia explícita.

### T10 — Tools de análise [P com T9]

- Depends on: T7, T8
- Requirement: MCP-03, MCP-04
- Entrega: `tools/analysis-tools.ts` — `run_pr_analysis` (fixa `policies.publish: "auto_safe"` sempre), `get_analysis`; usa `principal.actingJwt`, renova via novo `introspect` se expirado antes de uma chamada.
- Gate: testes unitários — policy sempre forçada mesmo se cliente mandar `manual`; 404 upstream (fora de escopo) repassado como 404, não 403; `actingJwt` expirado dispara reintrospecção antes do retry.

### T11 — Rate limiting

- Depends on: T6
- Requirement: infra (NFR)
- Entrega: throttle por token MCP e por IP, defaults `60 req/min/token` e `300 req/min/IP`, configuráveis via env.
- Gate: teste — Nª+1 chamada no mesmo token dentro da janela devolve 429; IP diferente com token diferente não é afetado.

### T12 — Registro final das tools no server

- Depends on: T9, T10, T11
- Requirement: MCP-01..MCP-04
- Entrega: `server.ts` registra as 5 tools no SDK, aplica middleware de auth + rate limit antes de cada chamada.
- Gate: `@modelcontextprotocol/inspector` lista as 5 tools com schema correto; uma chamada fim a fim de cada tool contra ambiente local (Nest + ai-api + neo4j/redis/postgres do compose) funciona.

### T13 — `docker-compose`: serviço `mcp-server`

- Depends on: T12
- Requirement: infra (decisão registrada em design.md)
- Entrega: `apps/mcp-server/Dockerfile`, entrada em `docker-compose.yml` com healthcheck e envs apontando pros outros serviços.
- Gate: `docker compose up mcp-server` sobe e fica `healthy`.

### T14 — Gates automatizados + documentação

- Depends on: T13
- Requirement: MCP-01..MCP-06
- Entrega: roda suites Nest e mcp-server, lint, build de todos os apps tocados; novo `docs/ARCHITECTURE-mcp-server.md` (ou seção em `ARCHITECTURE-backend.md`) descrevendo o fluxo implementado.

### T15 — UAT manual com cliente MCP real

- Depends on: T14
- Requirement: MCP-01..MCP-06 (validação fim a fim)
- Entrega: configurar Claude Desktop/Code apontando pro `mcp-server` local; indexar repo de teste; disparar análise de PR real; revogar token e confirmar bloqueio imediato (não esperar TTL de 7 dias nem cache de 30s de introspecção — revogação some no próximo round-trip por já checar `revokedAt` a cada introspecção).

## Validation

| Task | Granular | Dependencies match | Tests co-located |
| --- | --- | --- | --- |
| T1 | ✅ | ✅ | ✅ |
| T2 | ✅ | ✅ | ✅ |
| T3 | ✅ | ✅ | ✅ |
| T4 | ✅ | ✅ | ✅ |
| T5 | ✅ | ✅ | n/a (scaffold) |
| T6 | ✅ | ✅ | smoke (inspector) |
| T7 | ✅ | ✅ | ✅ |
| T8 | ✅ | ✅ | ✅ |
| T9 | ✅ | ✅ | ✅ |
| T10 | ✅ | ✅ | ✅ |
| T11 | ✅ | ✅ | ✅ |
| T12 | ✅ | ✅ | smoke (inspector + e2e local) |
| T13 | ✅ | ✅ | infra check |
| T14 | ✅ | ✅ | gate |
| T15 | ✅ | ✅ | UAT |

## Validation Result

- Backend: 82 suites / 687 testes passando; build limpo; lint (Biome) 0 erros.
- mcp-server: 8 suites / 36 testes passando; build limpo; lint (Biome) 0 erros.
- Docker: `apps/mcp-server/Dockerfile` builda e sobe `healthy` via `docker compose`.
- T12 (smoke e2e real): cadeia completa validada — mcp-server → introspecção (Nest) → `ai-api` (índice) e → Nest (`actingJwt`, análise) — contra Postgres/Redis/Neo4j/Nest/ai-api reais, token MCP real, 5 tools listadas e chamadas via `@modelcontextprotocol/inspector`. 2 bugs reais encontrados e corrigidos nesse processo (`JwtModule` faltando em `mcp-tokens.module.ts`; `issue()` precisava de `repository.create()` antes de `save()`).
- T15 (UAT): revogação de token confirmada — funciona dentro de até `MCP_TOKEN_CACHE_TTL_SECONDS` (30s), não na chamada seguinte (spec.md e design.md atualizados para refletir isso). Expiração de token confirmada com o mesmo comportamento de cache. `run_pr_analysis` contra PR real do GitHub **não executado** — falta PAT do GitHub + chave de LLM real no ambiente; passos para completar documentados no relatório da task.
- Doc de arquitetura: `docs/feature-mcp-server/ARCHITECTURE-mcp-server.md`.
