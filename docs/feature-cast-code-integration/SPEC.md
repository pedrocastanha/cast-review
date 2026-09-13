# SPEC — Cast Code como cliente oficial do Cast Review

**PRD:** [PRD.md](./PRD.md)  
**Status:** Aprovado para execução  
**MCP:** fora de escopo

## 1. Arquitetura

```text
Cast Code                         Cast Review
┌───────────────────────┐         ┌──────────────────────────────┐
│ cast review / REPL    │  HTTPS  │ Nest API                     │
│ config + cred store   │────────▶│ auth + refresh rotativo      │
│ HTTP/SSE client       │  JWT    │ ChatService + RLS            │
│ terminal renderer     │◀────────│   └─ ai-api (interno)        │
└───────────────────────┘   SSE   └────────────┬─────────────────┘
                                               ▼
                                     Postgres/Redis/Neo4j
```

Não existe chamada CLI → `ai-api`. O módulo legado Platform não participa da aplicação. O módulo `cast-review` é estritamente lazy: sua construção não faz I/O e apenas comandos `review`/`/cast-review` iniciam autenticação ou rede.

## 2. Configuração

Global:

```yaml
# ~/.cast/config.yaml
castReview:
  apiUrl: "http://127.0.0.1:3000"
```

Projeto:

```yaml
# .cast/cast.yaml
version: 1
project:
  environment: node
castReview:
  apiUrl: "http://127.0.0.1:3000"
  repository: "owner/repo"
  mode: repository # repository | global
```

Precedência: flag → manifesto → global → default. URL é normalizada sem `/` final. HTTP é permitido para `localhost`, `127.0.0.1` e `::1`; outros hosts exigem HTTPS.

`ProjectManifestService` é o único responsável por ler/mesclar/gravar `.cast/cast.yaml`. Escrita é atômica e preserva seções não relacionadas. `EnvironmentActivationService` migra para ele antes da retirada de `PlatformConfigService`.

## 3. Credenciais e sessão HTTP

O store padrão é `~/.cast/credentials/cast-review.json`, injetável por `CAST_REVIEW_CREDENTIALS_FILE` em testes. Diretório usa `0700`; arquivo usa `0600`.

```json
{
  "version": 1,
  "origins": {
    "http://127.0.0.1:3000": {
      "refreshCookie": "cast_refresh=...",
      "expiresAt": "2026-09-20T12:00:00.000Z"
    }
  }
}
```

- Senha nunca é gravada; cookie nunca aparece em config, logs, status ou erros.
- Access JWT fica em memória e cada credencial é vinculada à origin normalizada.
- Escrita usa arquivo temporário no mesmo diretório + rename e corrige permissões.

Fluxo:

1. `GET /instance` obtém `frontendUrl`.
2. `POST /auth/login` envia `{email|username,password}`, `Origin: frontendUrl` e `X-Cast-CSRF: 1`.
3. CLI captura `Set-Cookie: cast_refresh`, persiste o cookie e mantém `{accessToken}` em memória.
4. Em 401 autenticado, tenta uma vez `/auth/refresh`, atualiza cookie rotacionado e repete uma vez.
5. `/auth/logout` envia cookie + CSRF; credencial local é removida em `finally`.

Não é criado device flow, API key, migration ou guard novo. `CREDENTIALS_MODE=ephemeral` fica fora do MVP.

## 4. Contrato backend reutilizado

| Método | Rota | Uso |
| --- | --- | --- |
| GET | `/health` | disponibilidade |
| GET | `/instance` | metadados e `frontendUrl` |
| POST | `/auth/login` | access JWT + refresh cookie |
| POST | `/auth/refresh` | rotação |
| POST | `/auth/logout` | revogação |
| GET | `/users/:sub` | status/identidade |
| POST | `/chat/threads` | criar thread |
| GET | `/chat/threads/:id` | reabrir/persistência |
| POST | `/chat/threads/:id/messages` | SSE |

Única mudança backend: `/instance` retorna `frontendUrl`, derivado de `FRONTEND_URL` ou da primeira origin permitida.

Thread: `{"scope":{"mode":"repository","repoId":"owner/repo"}}` ou `{"scope":{"mode":"global"}}`.

Mensagem:

```json
{
  "content": "onde a autenticação é validada?",
  "model": "gpt-5.4-mini",
  "assistanceMode": "general",
  "repositoryHint": "owner/repo"
}
```

`assistanceMode` aceita `general | requirements`. Limites seguem os DTOs atuais; a CLI não replica regras divergentes.

## 5. SSE

Frames são `data: <json>\n\n`. O parser aceita LF/CRLF, chunks partidos, comentários/keepalive e vários frames por chunk.

| Tipo | Ação |
| --- | --- |
| `token` | acrescentar delta imediatamente |
| `tool_call` | linha compacta com nome |
| `tool_result` | resumo seguro, sem dump bruto |
| `message_done` | fechar; mostrar citações/uso e capturar conteúdo final |
| `error` | encerrar com erro tipado |

SIGINT aborta request e restaura terminal. `X-Chat-Message-Id` e `threadId` ficam disponíveis para verificação, sem telemetria.

## 6. Módulo CLI

```text
src/modules/cast-review/
  cast-review.module.ts
  types/cast-review.types.ts
  services/cast-review-config.service.ts
  services/cast-review-credential-store.service.ts
  services/cast-review-client.service.ts
  services/cast-review-repository.service.ts
  services/cast-review-session.service.ts
  services/cast-review-commands.service.ts
  services/*.spec.ts
```

Comandos:

```text
cast review configure [--url URL]
cast review login [--url URL]
cast review logout [--url URL]
cast review status [--url URL]
cast review link [--repository owner/repo | --global] [--url URL]
cast review chat <message> [--repository owner/repo | --global] [--model MODEL] [--mode general|requirements] [--url URL]
```

Login usa prompt oculto. Testes injetam prompt/store; senha em argv não é suportada. REPL oferece `/cast-review chat|status|logout`. Comandos Platform são mensagens de migração.

## 7. Retirada do Platform

- Remover `PlatformModule` de App/Core/Repl/Memory/Benchmark/Scheduler/Environment.
- Remover bootstrap remoto, sessão/telemetria, runtime projector e RAG remoto.
- Remover sync de benchmark/schedule, mantendo execução/relatórios/store locais.
- Preservar registries genéricos, bridge, memória local, benchmark, schedule e ambientes.
- Manter `platform_project_id` nullable no SQLite; nenhuma migration destrutiva.
- Config nova usa `castReview`; `platform` legado não é lido.

## 8. Falhas

| Situação | Resultado |
| --- | --- |
| URL inválida | recusa antes de I/O |
| servidor offline | timeout e erro acionável; CLI local continua |
| login inválido | erro seguro, sem persistência |
| access expirado | uma rotação e um retry |
| refresh inválido | limpa credencial e exige login |
| repo sem acesso/índice | propaga erro do backend; sem fallback |
| SSE inválido | erro de protocolo; prompt restaurado |
| logout offline | credencial local removida; aviso remoto |

Erros são sanitizados e limitados. Nenhum body bruto com segredo/tool payload é logado.

## 9. Testes e smoke

### CLI

- Manifesto, URL precedence/validation e preservação.
- Store: permissões, origins, rotação, remoção e redaction.
- Login/refresh/logout e retry único com fetch fake.
- SSE fragmentado, CRLF, erro e abort.
- Git remote HTTPS/SSH e ausência segura.
- Comandos/REPL, `/review` separado e tombstones.
- Regressão do runtime sem Platform e features locais.

### Backend

- `/instance.frontendUrl` com env/default.
- E2E real de HTTP: login-cookie → refresh → JWT → thread → SSE fake → GET persistido → logout.
- RLS: usuário B não lê thread de A.

### Smoke real

1. Subir Postgres/Redis/Neo4j e migrations.
2. Iniciar ai-api/backend com segredos apenas no ambiente e `CREDENTIALS_MODE=stored`.
3. Usar conta normal com OpenAI/PAT salvos e repo indexado.
4. Build do Cast; `configure`; `login`; `link`; `chat` que exige grafo.
5. Exigir `message_done`; para índice, tool call/result e citação.
6. Reabrir thread, validar mensagens, fazer logout e provar refresh recusado.

Smoke automatizado injeta credential path temporário; nunca substitui `HOME` nem usa chave real.
