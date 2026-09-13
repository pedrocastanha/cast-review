# PRD — Cast Code como cliente oficial do Cast Review

**Status:** Aprovado para execução  
**Data:** 2026-09-13  
**Escopo:** `cast-code` + `fullstack-1`  
**Fora de escopo:** servidor MCP

## Resumo

O `fullstack-1` (Cast Review) passa a ser a única integração remota oficial do Cast Code. A ideia do Cast Platform separado é abandonada: o comando, configuração, RAG, catálogo remoto, telemetria de sessão e sincronizações de benchmark/schedule daquele produto deixam de participar do runtime da CLI.

A nova integração é explícita: o usuário configura a URL do Cast Review, faz login com a conta existente e conversa com o chat do produto pelo terminal. O backend atual continua sendo a autoridade de autenticação, acesso a projetos/repositórios, índice, ferramentas, persistência e custo. A CLI não acessa `ai-api`, Redis, Neo4j, Postgres, GitHub ou OpenAI diretamente.

## Evidências da auditoria

| Área | Encontrado | Decisão |
| --- | --- | --- |
| `cast-code` | CLI NestJS/TypeScript com REPL e comandos diretos. | Criar módulo `cast-review` seguindo os padrões existentes. |
| `src/modules/platform` | Control plane antigo por `csk_*`, `/v1`, skills/agentes/MCP/RAG, telemetria, benchmark e schedule. | Aposentar a superfície e remover seus acoplamentos. Não reapontar o cliente. |
| Manifesto local | `PlatformConfigService` também lê/escreve `project.environment*`. | Extrair `ProjectManifestService` antes de remover Platform. |
| Cast Review backend | JWT curto + refresh cookie rotativo, RLS, `ChatService` e SSE prontos. | Reutilizar o contrato existente; não criar `/cli/v1`, PAT ou device flow no MVP. |
| Segurança HTTP | Login/refresh/logout exigem `Origin` permitido e `X-Cast-CSRF: 1`. | `/instance` informa `frontendUrl`; a CLI mantém essa proteção. |
| Runtime local | Benchmark, schedule, memória e agentes funcionam sem Platform. | Preservar funções locais e remover somente sync/RAG/telemetria exclusivos do legado. |

## Problema

Hoje a CLI tem uma integração remota que aponta para um produto descontinuado, enquanto o Cast Review já concentra autenticação, repositórios indexados e chat com código. Manter as duas ideias criaria comandos, credenciais e expectativas concorrentes.

Só trocar a URL de `PlatformService` não funciona: o contrato legado representa projetos remotos e telemetria; o Cast Review representa usuários, threads e mensagens SSE. A migração precisa remover o contrato antigo e introduzir um cliente próprio.

## Objetivos

- Tornar Cast Review a única integração remota e o padrão da CLI.
- Configurar URL global uma vez, com override opcional por projeto.
- Autenticar com a conta existente sem persistir senha; access token em memória e refresh cookie em arquivo privado `0600`.
- Criar thread global ou vinculada a `owner/repo`, enviar mensagem e mostrar SSE, ferramentas, citações e uso.
- Reutilizar refresh rotativo e logout do backend.
- Preservar `cast`, `/review`, bridge, agentes, memória, benchmark, schedule e ambientes locais.
- Remover RAG remoto, definições remotas, telemetria e sincronizações do Cast Platform.
- Provar a integração com testes automatizados e smoke do Cast real.

## Não objetivos

- Servidor MCP.
- Compatibilidade ou migração de dados do Cast Platform.
- Novo device flow, API key ou token de integração.
- Expor serviços/bancos internos à CLI.
- Fazer prompts normais do agente local usarem Cast Review silenciosamente.
- Portar RAG remoto, catálogo remoto, telemetria, benchmark ou schedule do legado.
- Suportar `CREDENTIALS_MODE=ephemeral` no primeiro corte; o smoke usa `stored`.

## Experiência do usuário

```bash
cast review configure --url http://127.0.0.1:3000
cast review login
cast review status

cd ~/code/acme/api
cast review link --repository acme/api
cast review chat "onde a autenticação HTTP é validada?"
cast review logout
```

No REPL:

```text
/cast-review status
/cast-review chat onde a autenticação HTTP é validada?
/cast-review logout
```

`/review` continua sendo revisão Git local. `cast platform`, `cast link`, `/platform` e `/link` tornam-se tombstones que explicam a migração sem executar o protocolo antigo.

## Decisões de produto

1. **Destino padrão:** API Cast Review em `http://127.0.0.1:3000` no desenvolvimento. Fora de loopback, somente HTTPS.
2. **Configuração:** `~/.cast/config.yaml` usa `castReview.apiUrl`; `.cast/cast.yaml` pode conter `castReview.apiUrl`, `repository` e `mode`. Nenhum segredo entra no manifesto.
3. **Credencial:** login solicita identificador e senha, sem persistir a senha. O refresh cookie é associado à origin e gravado em store separado com permissão `0600`; access JWT vive em memória. A porta do store é injetável para adoção futura de keychain.
4. **Backend mínimo:** reutilizar `/auth/*`, `/users/:id` e `/chat/*`. `GET /instance` passa a informar `frontendUrl` para o header `Origin` exigido pelo CSRF.
5. **Escopo:** remote GitHub ou vínculo explícito produz `owner/repo`; o backend sempre revalida acesso e índice. Ausência de repo usa thread global.
6. **Falhas:** não há fallback silencioso do chat remoto para o agente local. O erro é mostrado e a CLI permanece utilizável.
7. **Aposentadoria:** código legado sai da composição. Benchmark/schedule continuam locais; seus syncs somem. O campo SQLite legado `platform_project_id` permanece nullable por compatibilidade.
8. **Login opt-in:** iniciar `cast` e usar qualquer função local nunca exige login nem faz request ao Cast Review; autenticação começa somente em `cast review` ou `/cast-review`.

## Critérios de aceitação

- **CR-01:** URL segue flag → projeto → global → `http://127.0.0.1:3000`; HTTP só em loopback.
- **CR-02:** `configure` e `link` preservam YAML não relacionado e nunca gravam segredo no projeto.
- **CR-03:** `login` usa `/instance` + `/auth/login`, mantém headers CSRF, não persiste senha e guarda refresh em arquivo privado.
- **CR-04:** access expirado dispara uma rotação e um único retry; refresh inválido não entra em loop.
- **CR-05:** `logout` revoga refresh no servidor e apaga credencial local mesmo offline.
- **CR-06:** `status` identifica servidor/usuário ou explica reparo sem imprimir segredo.
- **CR-07:** `chat` cria/reutiliza thread na execução e respeita escopo global/repository.
- **CR-08:** eventos `token`, `tool_call`, `tool_result`, `message_done` e `error` são processados em ordem, inclusive chunks partidos e cancelamento.
- **CR-09:** thread/mensagens persistidas reabrem por `GET /chat/threads/:id`; outro usuário não acessa.
- **CR-10:** runtime normal não inicia Platform, carrega remoto, envia telemetria nem oferece RAG remoto.
- **CR-11:** recursos locais continuam funcionando; somente syncs antigos são removidos.
- **CR-12:** comandos legados mostram migração; `/review` mantém semântica local.
- **CR-13:** testes/builds passam nos dois repositórios e smoke real cobre login → SSE → persistência → logout.
- **CR-14:** inicialização e prompt local funcionam sem credencial de Cast Review e sem tentativa de rede.

## Métricas de sucesso

- Configuração, login e primeira mensagem em menos de dois minutos com ambiente pronto.
- 100% das mensagens remotas passam por `ChatService`.
- Nenhuma senha, JWT, refresh, chave OpenAI ou PAT aparece em YAML, log ou stdout.
- Cast local funciona sem Cast Review configurado ou online.
- Smoke real observa `message_done`; para código indexado, tool call/result e citação válida.

## Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Store de refresh em disco | Arquivo dedicado `0600`, origin-bound e nunca exibido; adapter futuro de keychain. |
| CSRF quebrado por CLI | Descobrir `frontendUrl` em `/instance` e preservar headers atuais. |
| Confusão com Platform | Remover config/ajuda atual e manter só tombstone. |
| Repo não autorizado/indexado | Detecção é hint; backend é autoridade. |
| SSE interrompido | AbortController e cleanup em `finally`. |
| Credenciais ausentes | `status` diagnostica; smoke exige conta normal com OpenAI/PAT e `stored`. |

## Traceability

CR-01..CR-13 são mapeados na SPEC e em TASKS. MCP permanece adiado.
