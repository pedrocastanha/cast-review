# SPEC: Chat sobre Repositório e Projeto

**Data:** 2026-08-27
**PRD:** [PRD.md](./PRD.md)

## 1. Arquitetura

```
Front (React)              Nest (backend)                    ai-api (FastAPI)
  ChatPage      ──POST──▶  ChatService                          POST /chat/run
  SSE stream    ◀────────    authz + Postgres        ──SSE──▶     loop de tools
                             resolve menções                        ↓
                             GitHub fallback                    Neo4j (Graph)
```

**Fronteiras.** O NestJS é dono de autorização, persistência e GitHub — é onde a sessão do usuário vive. O `ai-api` é dono do LLM e do grafo, e nunca fala com o GitHub. O front só renderiza.

**Menções são resolvidas antes do loop.** O NestJS resolve o conteúdo de cada `@arquivo` e o entrega pronto no corpo da requisição. Isso mantém a credencial do GitHub fora do `ai-api`. O custo é a limitação registrada no PRD: o agente não abre, por conta própria, arquivo que não está no grafo.

**Sem LangGraph.** O loop é um `while` assíncrono simples em `app/chat/agent.py`. LangGraph existe no projeto para o pipeline de review porque lá há `interrupt()` e checkpoint de aprovação humana. O chat não tem nenhum dos dois: uma volta de ferramenta não precisa ser retomável, e o estado da conversa vive no Postgres, não no checkpointer. Usar LangGraph aqui adicionaria schema de estado e um grafo de um nó só.

## 2. Modelo de dados

Migration `CreateChatThreads`, seguindo `DefaultEntity` (uuid, `created_at`, `updated_at`, `deleted_at`, `active`).

### `chat_threads`

| coluna | tipo | nota |
|---|---|---|
| `user_id` | uuid | índice; dono da thread |
| `scope_type` | varchar | `repository` \| `project` |
| `repo_id` | varchar null | `owner/repo`, quando `repository` |
| `project_id` | uuid null | quando `project` |
| `title` | varchar | derivado da primeira mensagem, editável |
| `scope` | jsonb | `ChatScope` congelado (repos + sha) |

Índice `IDX_chat_threads_user_updated` em `(user_id, updated_at)` para a listagem.

### `chat_messages`

| coluna | tipo | nota |
|---|---|---|
| `thread_id` | uuid | índice |
| `role` | varchar | `user` \| `assistant` |
| `content` | text | |
| `mentions` | jsonb | `[{repoId, path}]`, só em `user` |
| `tool_calls` | jsonb | `[{name, args, resultSummary, durationMs}]` |
| `citations` | jsonb | `[{repoId, path, line, symbolId, symbolName}]` |
| `usage` | jsonb | `{promptTokens, completionTokens, costUsd}` |
| `truncated` | boolean | teto de iterações estourado |

Índice `IDX_chat_messages_thread_created` em `(thread_id, created_at)`.

### `ChatScope` (jsonb congelado)

```ts
type ChatScope = {
  mode: 'repository' | 'project';
  projectId?: string;
  projectName?: string;
  repositories: Array<{
    repoId: string;
    sha: string | null;
    included: boolean;
    omissionReason: string | null;
  }>;
};
```

Montado por `ChatService` na criação. Escopo `project` reaproveita `ProjectsService.members` + `memberStatus`; repositório sem `sha` entra com `included: false`. Thread onde nenhum repositório tem `sha` é rejeitada com `400`.

## 3. Contratos HTTP

### 3.1 NestJS (prefixo global `api`)

| método | rota | corpo / query | resposta |
|---|---|---|---|
| `POST` | `/chat/threads` | `CreateChatThreadDto` | `ChatThreadDto` |
| `GET` | `/chat/threads` | `?repoId=&projectId=` | `ChatThreadDto[]` |
| `GET` | `/chat/threads/:id` | — | `ChatThreadDto` + `messages` |
| `PATCH` | `/chat/threads/:id` | `{title}` | `ChatThreadDto` |
| `DELETE` | `/chat/threads/:id` | — | `204` |
| `GET` | `/chat/threads/:id/files` | `?query=&limit=` | `ChatFileDto[]` |
| `POST` | `/chat/threads/:id/messages` | `SendChatMessageDto` | `text/event-stream` |

```ts
class CreateChatThreadDto {
  scope: { mode: 'repository'; repoId: string } | { mode: 'project'; projectId: string };
}

class SendChatMessageDto {
  content: string;                                  // 1..8000
  mentions: Array<{ repoId: string; path: string }>; // até 10
  model: string;
  apiKeys: { openai: string };
}

type ChatFileDto = { repoId: string; path: string };
```

`GET /chat/threads/:id` compara o `sha` congelado com `AiApiClient.getIndexStatus` e devolve `staleRepositories: string[]` — é o que alimenta o aviso de índice desatualizado.

### 3.2 ai-api

| método | rota | nota |
|---|---|---|
| `POST` | `/chat/run` | SSE, o loop |
| `GET` | `/index/file` | `?repoId&sha&path` — remonta arquivo do grafo |
| `GET` | `/index/files` | `?repoId&sha&query&limit` — paths distintos |

```py
class ChatScopeRepository(BaseModel):
    repoId: str
    sha: str

class ChatMention(BaseModel):
    repoId: str
    path: str
    content: str

class ChatHistoryMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str

class ChatRunRequest(BaseModel):
    threadId: str
    mode: Literal["repository", "project"]
    projectId: str | None = None
    repositories: list[ChatScopeRepository]
    history: list[ChatHistoryMessage] = []
    question: str
    mentions: list[ChatMention] = []
    model: str
    apiKeys: ApiKeys
```

`GET /index/file` responde `404` quando o `path` não tem nenhum símbolo no grafo — é o gatilho do fallback GitHub no NestJS. O corpo é remontado ordenando os símbolos do arquivo por `line` e concatenando `body`, com marcador `# ... (linhas N-M omitidas)` entre trechos não contíguos, porque o grafo guarda corpo por símbolo e não o arquivo inteiro.

### 3.3 Eventos SSE (`ChatEvent`)

```py
ChatEventType = Literal["tool_call", "tool_result", "token", "message_done", "error"]
```

| tipo | payload |
|---|---|
| `tool_call` | `{iteration, name, args}` |
| `tool_result` | `{iteration, name, itemCount, truncated, durationMs}` |
| `token` | `{delta}` |
| `message_done` | `{content, citations, toolCalls, usage, truncated}` |
| `error` | `{message}` |

`tool_result` carrega resumo, não o payload da ferramenta — o conteúdo bruto vai só para o modelo. O NestJS repassa todos os eventos e intercepta `message_done` para gravar a mensagem do assistant.

## 4. Ferramentas do agente

Todas operam sobre os `Graph` já carregados em memória (`cache.lookup` uma vez por repositório do escopo, no início da mensagem). Nenhuma ferramenta faz round-trip HTTP.

Envelope de retorno comum:

```py
class ToolResult(BaseModel):
    items: list[dict]
    citations: list[Citation]
    truncated: bool = False
    note: str | None = None
```

| ferramenta | argumentos | retorno |
|---|---|---|
| `list_files` | `repoId?`, `pathPrefix?`, `limit=100` | paths distintos do índice |
| `search_symbols` | `query`, `repoId?`, `kind?`, `limit=20` | símbolos por match em nome/assinatura, ordenados por score |
| `read_symbol` | `repoId`, `symbolId` | assinatura + corpo completo |
| `read_file` | `repoId`, `path` | arquivo remontado dos símbolos |
| `neighbors` | `repoId`, `symbolId`, `direction`, `depth=1` | callers, callees ou ambos |
| `list_endpoints` | `repoId?`, `role?`, `routeContains?` | endpoints HTTP do índice |
| `cross_repo_links` | — | arestas `CONSUMES` do projeto |

`cross_repo_links` só é exposta ao modelo quando `mode == "project"`; reaproveita `cache.materialize_project_graph`. `search_symbols` pontua por: match exato de nome (3), prefixo (2), substring em nome (1), substring em assinatura (0.5); empate desempata por menor `path`.

Argumento `repoId` omitido em thread de repositório único assume aquele repositório. Em thread de projeto, omitido significa "todos os incluídos".

**Truncamento.** Cada `ToolResult` é serializado e cortado em 6000 caracteres; `truncated: true` e `note` explicam o corte ao modelo. Corpo de símbolo acima de 4000 caracteres é cortado com marcador.

## 5. Loop do agente

`app/chat/agent.py`:

```
carrega grafos do escopo
monta system prompt + histórico + menções resolvidas + pergunta
iteration = 0
enquanto iteration < MAX_ITERATIONS (8):
    resposta = complete_with_tools(...)
    se não há tool_calls: emite tokens, encerra
    para cada tool_call:
        emite tool_call
        executa, acumula citações
        emite tool_result
        anexa role=tool ao histórico do modelo
    iteration += 1
estourou: força uma última volta sem tools, marca truncated
```

**Anti-loop.** Assinatura `(name, args canonizados em JSON ordenado)` de cada chamada é guardada. Repetição exata é respondida sem reexecutar, com `note: "chamada idêntica já executada nesta mensagem"`. Duas repetições encerram a investigação e forçam a resposta final.

**Citações.** O acumulador guarda toda citação retornada por ferramenta. Na `message_done`, cada citação é validada contra o grafo (o `path` existe naquele `repoId@sha`; se houver `symbolId`, o nó existe). Citação que não resolve é descartada.

**System prompt** fixa: responder em português, citar sempre, nunca inventar caminho, usar `list_files`/`search_symbols` antes de afirmar que algo não existe, e declarar explicitamente quando a resposta é incerta.

## 6. Extensão do cliente LLM

`app/infrastructure/llm/client.py` ganha `complete_with_tools`, ao lado de `complete_json` — sem alterar `complete_json`, que o pipeline de review usa.

```py
@dataclass(frozen=True)
class ToolCall:
    id: str
    name: str
    arguments: dict

@dataclass(frozen=True)
class LlmToolResult:
    content: str
    tool_calls: list[ToolCall]
    usage: TokenUsage

async def complete_with_tools(
    *,
    system: str,
    messages: list[dict],
    tools: list[dict],
    model: str,
    api_key: str,
    on_delta: OnDelta | None = None,
) -> LlmToolResult: ...
```

Streaming: acumula `choices[].delta.content` (repassado por `on_delta`) e `choices[].delta.tool_calls[]`, que chegam fragmentados — cada fragmento traz `index`, e `function.arguments` vem em pedaços que precisam ser concatenados por `index` antes do `json.loads`. `stream_options.include_usage` já é usado por `complete_json` e se mantém. Erros de parse de argumento viram `LlmError` com o nome da ferramenta.

## 7. Frontend

**Rotas** (dentro do padrão atual):
- `/repos/:owner/:repo/chat` — dentro de `RepositoryLayout`, vira mais uma aba ao lado de `graph`, `pulls`, `runs`
- `/projects/:id/chat`

**Componentes** em `src/components/chat/`:
- `ChatPage` — layout de duas colunas: lista de threads à esquerda, conversa à direita
- `MessageList` / `MessageBubble` — markdown na resposta, bloco de código com destaque
- `ToolTrace` — colapsável por mensagem, mostra `tool_call`/`tool_result` em ordem
- `CitationList` — chips por citação; clique navega para `/repos/:owner/:repo/graph?focus=<symbolId>`
- `MentionInput` — textarea com autocomplete em `@`, consultando `GET /chat/threads/:id/files`
- `StaleIndexBanner`

`src/api/chat.api.ts` reaproveita `consumeSseStream` de `analyses.api.ts` — ele é extraído para `src/api/sse.ts` e importado pelos dois, em vez de duplicado.

A chave OpenAI vem de `openai-key-store.ts`, igual ao fluxo de análise.

## 8. Erros

| situação | comportamento |
|---|---|
| thread de outro usuário | `404` (não `403`, para não vazar existência) |
| repositório do escopo perdeu acesso | `403` na mensagem; thread continua legível |
| nenhum repositório com `sha` | `400` na criação |
| `ai-api` fora | evento `error` no stream, mensagem do usuário permanece gravada |
| chave OpenAI inválida | `LlmError` vira evento `error`; nada é gravado como resposta |
| ferramenta lança exceção | vira `tool_result` com `note` de erro; o loop continua |
| cliente desconecta | `AbortSignal` propaga do Nest ao `ai-api`; loop encerra |
| menção a arquivo inexistente | ignorada, com `note` na primeira volta informando o modelo |

Mensagem do usuário é gravada **antes** da chamada ao `ai-api`. Falha no meio do stream deixa a pergunta no histórico sem resposta, e a UI oferece reenviar.

## 9. Testes

**ai-api (pytest)**
- `test_chat_tools.py` — cada ferramenta sobre `Graph` sintético: escopo, limites, truncamento, citações
- `test_chat_agent.py` — loop com LLM fake (`tests/llm_fakes.py`): sem tool call, uma volta, várias voltas, teto de iterações, chamada repetida, exceção em ferramenta
- `test_llm_tools_client.py` — remontagem de `tool_calls` fragmentados no stream, `usage`, erro de parse
- `test_chat_run_route.py` — sequência de eventos SSE
- `test_index_file_route.py` — remontagem, `404`, lacunas entre símbolos

**backend (jest)**
- `chat.service.spec.ts` — authz, congelamento de escopo, resolução de menção com fallback GitHub, persistência da resposta em `message_done`, `staleRepositories`
- `chat.controller.spec.ts` — validação de DTO, repasse do SSE

**frontend**
- `MentionInput` — autocomplete, inserção, limite de 10
- `ChatPage` — renderização por tipo de evento

**browser (claude-in-chrome)** — validação final: criar thread em repositório indexado, perguntar com menção, ver `tool_call`/`token` em tempo real, clicar em citação e cair no nó certo do grafo.

## 10. Ordem de implementação

1. `ai-api`: `complete_with_tools` + testes
2. `ai-api`: ferramentas sobre `Graph` + testes
3. `ai-api`: loop, `POST /chat/run`, `GET /index/file`, `GET /index/files` + testes
4. `backend`: entidades, migration, `AiApiClient.runChat`/`getIndexFile`/`listIndexFiles`
5. `backend`: `ChatService` + `ChatController` + testes
6. `frontend`: `sse.ts` extraído, `chat.api.ts`, componentes, rotas
7. Validação no browser
