# SDD: Chat Global e Chat por Repositório

**Status:** Proposto

**Data:** 2026-08-29

**PRD:** [Chat Global e Chat por Repositório](./PRD.md)

## 1. Decisões de arquitetura

1. O backend NestJS permanece dono de autenticação, autorização, GitHub, persistência e grants internos. A AI API continua dona do loop de ferramentas, do grafo e do LLM.
2. O modo `project` deixa de ser criado e exibido. Os únicos modos novos são `global` e `repository`; valores históricos `project` continuam parseáveis para não corromper dados existentes.
3. Uma thread global não possui catálogo congelado. A AI API consulta o catálogo em runtime por uma ferramenta autenticada e paginada; ela não recebe a lista no system prompt.
4. Um workspace de grafo global é carregado por `repoId` apenas depois de autorização de catálogo. No máximo três workspaces ficam ativos por execução de mensagem.
5. O padrão de modelo é centralizado no frontend como `gpt-5.4-mini`, para Analysis e Chat. Não há whitelist de provedores/modelos: o campo aceita um identificador não vazio e o provedor valida a disponibilidade.

## 2. Contratos HTTP

### 2.1 Lista de repositórios

```http
GET /repositories?indexed=true
```

`indexed` é opcional. Sem ele, o endpoint permanece idêntico. Com `indexed=true`, o backend:

1. lista os repositórios autorizados via GitHub;
2. consulta em concorrência limitada o estado do índice de cada repositório;
3. devolve somente `status === 'indexed' && sha !== null`.

`stale` não remove o repositório: ele ainda possui uma versão de grafo válida. Falha pontual de status omite somente aquele repositório e é registrada com observabilidade segura.

O autocomplete do `/` é o primeiro consumidor desse parâmetro. A tela `ReposPage`, formulários de projeto e demais consumidores continuam chamando a lista sem filtro.

### 2.2 Threads

```ts
type CreateChatThreadPayload =
  | { scope: { mode: 'global' } }
  | { scope: { mode: 'repository'; repoId: string } };

type ChatScope =
  | { mode: 'global'; repositories: [] }
  | {
      mode: 'repository';
      repositories: Array<{
        repoId: string;
        sha: string;
        included: true;
        omissionReason: null;
      }>;
    };
```

O banco já armazena `scope_type` como `varchar`. Uma migration adiciona a coluna nullable `model` a `chat_messages`; mensagens de usuário e assistant recebem o modelo da requisição. Não é necessária migration para `global`; os tipos e validação de DTO passam a aceitá-lo.

`GET /chat/threads` lista somente `global` e `repository` por padrão. Threads `project` existentes não são apagadas. `GET /chat/threads/:id` permanece compatível para permitir suporte/recuperação até uma decisão de migração posterior.

### 2.3 Mensagem e marcação de repositório

```ts
type SendChatMessageDto = {
  content: string;
  mentions: Array<{ repoId: string; path: string }>;
  model: string;
  repositoryHint?: string; // somente global; derivado de /owner/repo
};
```

O compositor reconhece `/` somente no início da mensagem global. O dropdown consulta `GET /repositories?indexed=true`, usa navegação por setas/Enter/Escape e, ao selecionar, insere `/owner/repo` como marcador visível. O parser remove somente o marcador inicial do texto que o agente recebe e envia seu valor normalizado em `repositoryHint`. Não há busca de `/` no meio do texto, nem mais de uma pista por mensagem.

No chat de repositório, o marcador não é mostrado nem necessário. O `@` continua usando `GET /chat/threads/:id/files`; no global, `@` fica indisponível até existir um `repositoryHint` válido para a mensagem, evitando listar arquivos de um catálogo inteiro.

## 3. Catálogo global seguro

O serviço Nest cria, ao iniciar uma mensagem global, um grant interno efêmero com `userId`, `threadId`, expiração curta e audience `ai-api-chat-catalog`. O grant é assinado pelo backend e transportado somente no payload entre backend e AI API, nunca no prompt ou em um evento SSE.

A AI API usa esse grant, fora do contexto do LLM, para chamar endpoints internos do Nest:

```http
GET /internal/chat/catalog?query=&limit=&cursor=
GET /internal/chat/catalog/:owner/:repo
```

Os endpoints não fazem parte da API pública, exigem autenticação serviço-a-serviço e verificam assinatura, expiração e audience. Em cada consulta, o Nest usa o usuário do grant para reaplicar acesso GitHub e estado de índice. A resposta de lista é limitada a 20 itens e contém somente:

```ts
type CatalogEntry = {
  repoId: string;
  sha: string;
  stale: boolean;
};
```

O endpoint de resolução por `repoId` devolve a mesma estrutura ou `404`. Ele permite que um `repositoryHint` ou um `repoId` escolhido pelo LLM seja validado sem carregar o catálogo inteiro.

## 4. Ferramentas e engenharia de contexto

### Ferramentas globais

| Ferramenta | Finalidade | Limites |
| --- | --- | --- |
| `list_indexed_repositories(query?, cursor?, limit=20)` | Descobrir repositórios autorizados e indexados | máximo 20 entradas; só IDs, SHA curto, stale e cursor |
| `search_symbols(query, repoId, kind?, limit=20)` | Primeiro passo de investigação em um repositório escolhido | exige `repoId`; carrega grafo preguiçosamente |
| `list_files(repoId, pathPrefix?, limit=100)` | Confirmar caminho antes de alegar ausência | exige `repoId` |
| `read_symbol(repoId, symbolId)` / `read_file(repoId, path)` | Aprofundar somente após busca | corpo limitado a 4.000 caracteres |
| `neighbors(repoId, symbolId, direction, depth=1)` | Explorar chamadas/dependências | profundidade máxima 2 |
| `list_endpoints(repoId, role?, routeContains?)` | Investigar contratos HTTP | exige `repoId` |

`cross_repo_links` é removida. No modo global, `repoId` é obrigatório para todas as ferramentas de grafo: o agente não pode varrer todos os índices por omissão. A execução mantém um cache LRU de até três `RepoWorkspace`; a quarta carga remove o menos recentemente usado e emite nota de contexto reduzido no tool result. O SHA é obtido do catálogo no momento da carga.

No modo repository, as ferramentas atuais continuam podendo omitir `repoId`, pois existe um único workspace congelado.

### Prompt operacional

O system prompt deve ser construído por blocos estáveis e curtos, sem catálogo de repositórios:

1. **Papel e limite:** assistente de investigação somente leitura, em português, baseado no índice de código.
2. **Protocolo de escopo global:** quando a pergunta não traz `/owner/repo` ou nome inequívoco, chamar `list_indexed_repositories` com uma consulta curta; nunca adivinhar um repositório.
3. **Protocolo de evidência:** usar `search_symbols`/`list_files` antes de afirmar presença ou ausência; só afirmar código depois de ferramenta; associar cada afirmação a citações retornadas.
4. **Protocolo de orçamento:** investigar poucos repositórios, preferir uma hipótese por vez, não reler o mesmo corpo e encerrar com lacunas explícitas ao atingir limite.
5. **Formato:** resposta direta, com conclusões separadas de incertezas; sem paths, símbolos ou linhas inventados.

O histórico continua limitado a 20 mensagens. Resultados de ferramenta não entram no histórico persistido do prompt além da volta atual; somente um resumo seguro (`toolCalls`) vai ao Postgres. Repetições idênticas continuam bloqueadas e o máximo de oito iterações é mantido.

## 5. Fluxos

### Global sem marcação

1. UI cria/abre thread `global` e envia pergunta/modelo.
2. Nest persiste a pergunta e inclui um grant efêmero no `ChatRunRequest`.
3. AI API monta o prompt sem lista de repositórios.
4. O LLM chama `list_indexed_repositories`; a AI API busca a página no Nest interno.
5. O LLM escolhe um `repoId` e chama uma ferramenta de grafo; a AI API revalida/resgata SHA e carrega somente esse grafo.
6. A resposta chega por SSE, com tool trace, evidências, uso e modelo persistidos.

### Global com `/owner/repo`

1. O dropdown do compositor obtém opções de `GET /repositories?indexed=true`.
2. A UI envia `repositoryHint`; Nest valida-o no catálogo antes de iniciar a stream.
3. O prompt recebe apenas a pista escolhida, não o catálogo. A AI API pode materializar esse workspace quando necessário.
4. O restante do loop preserva as mesmas regras de evidência e orçamento.

### Repositório

1. A aba Chat recebe `owner`/`repo` pela rota e lista somente threads cujo `repoId` é aquele valor.
2. A criação resolve e congela o SHA, como no fluxo atual.
3. O prompt recebe o briefing de um repositório; o catálogo global e o marcador `/` não são expostos.

## 6. Frontend

### Rotas e navegação

- `/chat`: `ChatPage` global, sem `ScopePicker`.
- `/repos/:owner/:repo/chat`: `ChatPage` em modo repository, dentro de `RepositoryLayout`.
- `RepositoryLayout` ganha a aba Chat.
- A sidebar preserva `Chat` apontando para a superfície global.

### Componentes

| Componente | Alteração |
| --- | --- |
| `ChatPage` | recebe modo de rota; remove seleção de projeto; aplica filtro de thread por `repoId` no modo repository; mantém histórico global isolado. |
| `Composer` | adiciona modelo editável, sugestões, selector `/` global e parser de `repositoryHint`; preserva `@` no escopo válido. |
| `CitationList` | torna-se disclosure acessível, fechado inicialmente, agrupado por repositório/caminho. |
| `MessageTurn` | mostra o modelo persistido junto a tokens/custo e delega evidências ao disclosure. |
| `ScopePicker` | removido junto com o fluxo de projeto. |

O modelo pode ser representado por `input + datalist`, com `gpt-5.4-mini` como primeira sugestão. Isso preserva controle para especialistas sem fixar uma lista que envelhece.

## 7. Persistência e migrações

Migration `AddChatMessageModel`:

```sql
ALTER TABLE chat_messages ADD model varchar NULL;
```

Dados antigos ficam com `model = NULL` e a UI mostra `modelo não registrado` de forma discreta. A mensagem enviada e a resposta assistant da mesma execução gravam o mesmo identificador. O valor não substitui os campos de uso existentes.

## 8. Erros e degradação

| Situação | Comportamento |
| --- | --- |
| Nenhum repositório indexado | autocomplete vazio; o agente explica que não há índice disponível após chamar a ferramenta. |
| Hint `/owner/repo` não autorizado/não indexado | backend rejeita a mensagem com 400/404 seguro antes de chamar a AI API. |
| Grant expirado ou inválido | AI API encerra com evento `error`, sem conteúdo do catálogo. |
| Catálogo falha | tool result seguro com nota de indisponibilidade; o agente não inventa escopo. |
| Quarto workspace global | LRU descarta o menos recente e registra nota/truncamento. |
| Modelo inválido | evento `error` da stream; pergunta permanece no histórico e nenhuma resposta assistant é persistida. |
| Repositório sem índice na aba Chat | UI apresenta ação de indexar existente, sem iniciar chat. |

## 9. Estratégia de verificação

### Backend (Jest unit)

- `?indexed=true` filtra somente repositórios com SHA e preserva a lista sem parâmetro.
- DTO rejeita criação `project`, aceita `global` e `repository`.
- criação global persiste escopo vazio; criação repository mantém SHA congelado.
- listagem nova não inclui threads `project`.
- grant não aparece em DTO público/log/evento e o catálogo interno reaplica autorização.
- `repositoryHint` exige repositório elegível.
- modelo é persistido em ambas as mensagens.

### AI API (pytest unit)

- catálogo paginado não entra no prompt e respeita limite de 20.
- ferramenta global exige `repoId` para qualquer leitura de grafo.
- workspace é carregado preguiçosamente, revalidado e limitado a três.
- prompt força descoberta de escopo, evidência antes de conclusão e declaração de insuficiência.
- chamadas repetidas e erro de catálogo seguem o protocolo de truncamento/erro.

### Frontend (build e testes existentes)

- `/chat` não renderiza `ScopePicker`; rota de repositório filtra sua thread list e mostra aba ativa.
- `/` abre autocomplete filtrado, é navegável por teclado e envia somente `repositoryHint` selecionado.
- default de Chat e Analysis é `gpt-5.4-mini`.
- evidências permanecem fechadas inicialmente, mostram contador e renderizam links corretos ao abrir.

### Gates

- `cd apps/backend && npm run test`
- `cd apps/ai-api && pytest -m "not integration"`
- `cd apps/frontend && npx tsc -b && npx oxlint`
- Browser UAT: chat global sem `/`, global com `/`, chat por repositório, modelo alternativo, evidências recolhidas e reabertura de thread.

## 10. Qualidade de implementação

- Não adicionar comentários ao código de produção. Nomes, tipos, funções pequenas e a estrutura dos módulos devem tornar a intenção explícita.
- Manter a separação atual entre controller, service, use cases, cliente da AI API e componentes de UI; não concentrar o catálogo, o parser do compositor e o loop de ferramentas em um único módulo.
- Reutilizar `RepositoriesService`, `AiApiClient`, `consumeSseStream`, tipos compartilhados e padrões de erro existentes antes de criar novas abstrações.
- Fazer paginação, debounce, concorrência limitada e carga preguiçosa no ponto de fronteira adequado, para que a descoberta global não degrade a listagem normal de repositórios nem o chat de repositório.
- Escrever testes de contrato antes da implementação e manter os testes de fase inicial imutáveis até uma alteração deliberada da especificação.
