# Isolamento no Neo4j

Data: 2026-09-09. Cobre a pendência 2 de `IMPLEMENTATION.md` na parte de grafo.

## Estado

| Seção | Situação |
|---|---|
| 1. Leitura cross-tenant do grafo | **Corrigido.** `assertRepositoryAccess` + 4 testes de regressão |
| 2. Destruição de grafo entre usuários | **Corrigido.** delete por sha, lock por (dono, repo), MATCH rotulado, escrita antes da virada |
| 3. `ownerId` nos nós | **Feito.** Propagado por ai-api e backend; 5 testes de isolamento contra Neo4j real |
| 4. Grant nas rotas de conteúdo | Pendente |
| 5. Revalidação de permissão | Pendente |
| 6. Higiene de produção | Pendente (operação) |

Suites: 357 testes Python, 631 unitários do backend, 77 e2e.

---

## 0. Neo4j não tem RLS

A imagem em uso é `neo4j:5-community` (`docker-compose.yml`). RBAC de granularidade fina e múltiplos bancos são recursos **Enterprise**. Não existe equivalente de row level security na Community.

Logo, isolamento no grafo tem que ser construído em duas camadas:

1. propriedade de dono nos nós, aplicada em toda query;
2. autorização obrigatória na borda, antes de qualquer chamada ao ai-api.

O ai-api não tem noção de usuário: sua única barreira é o `AI_SERVICE_TOKEN` (`apps/ai-api/app/security.py`). Todo caminho que chega nele com esse token lê o grafo inteiro. A borda é o backend Nest, e é lá que a autorização precisa ser inegociável.

Estado atual, admitido no próprio docstring de `apps/ai-api/app/code_graph/cache.py`: escopo só por `repoId`/`sha`, "no multi-tenancy at the database level".

---

## 1. ACHADO — leitura cross-tenant do grafo sem verificação de acesso

**Severidade: alta. CORRIGIDO.**

`GET /repositories/:repo/graph?owner=<qualquer>&sha=<qualquer>`

Caminho: `src/modules/repositories/repositories.controller.ts:73` → `repositories.service.ts` → `src/modules/repositories/use-cases/get-repository-graph/get-repository-graph.use-case.ts:11`.

```ts
const owner =
  ownerOverride?.trim() ||
  (await this.githubSession.getSession(currentUser)).owner;
const repoId = `${owner}/${repo}`;

const resolvedSha =
  sha ?? (await this.aiApiClient.getIndexStatus(repoId)).sha;
if (!resolvedSha) {
  return { nodes: [], edges: [], stats: { indexed: false } };
}

return this.aiApiClient.getGraph(repoId, resolvedSha, focus, depth);
```

O problema: `owner` e `repo` vêm inteiramente do cliente, e **nenhuma chamada ao GitHub acontece no caminho**. Quando `ownerOverride` é fornecido, `githubSession.getSession` nem é invocado. `getIndexStatus` no ai-api é uma leitura direta de Neo4j (`get_latest_sha`), sem GitHub. `getGraph` idem.

Resultado: qualquer usuário autenticado lê o grafo de qualquer repositório indexado por qualquer outro usuário, informando `?owner=`.

O que vaza: árvore completa de arquivos, nomes de símbolos, tipos e o grafo de chamadas/imports (`apps/ai-api/app/code_graph/viz.py`). Não vaza o corpo do código — esse fica em `/index/file`, que hoje só é alcançado pelo chat, com escopo de thread. Ainda assim é a estrutura completa de um repositório privado.

**Contraste com o caminho correto**, em `get-repository-index-status.use-case.ts:26-31`: ele chama `githubSession.resolveDefaultBranchSha(session.octokit, owner, repo)` usando o token do próprio usuário. Se o usuário não tem acesso, o GitHub responde 404 e o fluxo morre. Essa é a verificação implícita de autorização, e é exatamente ela que falta no caminho do grafo.

### Correção aplicada

`GithubSessionProvider.assertRepositoryAccess` (`src/modules/repositories/use-cases/shared/github-session.provider.ts`), chamada em `GetRepositoryGraphUseCase` antes de qualquer contato com o ai-api. Testes em `get-repository-graph.use-case.spec.ts`.

Auditados os demais call sites que montam `${owner}/${repo}` a partir de entrada do cliente: todos os outros já passavam pelo GitHub com o token do próprio usuário (`resolveDefaultBranchSha` ou a própria chamada de conteúdo), o que é a verificação implícita. O caminho do grafo era o único que não tocava o GitHub.

A forma da verificação:

```ts
// src/modules/repositories/use-cases/shared/repository-access.provider.ts
async assertAccess(
  currentUser: CurrentUserData,
  owner: string,
  repo: string,
): Promise<void> {
  const session = await this.githubSession.getSession(currentUser);
  try {
    await this.githubSession.resolveDefaultBranchSha(session.octokit, owner, repo);
  } catch (err) {
    this.githubSession.handleGithubError(err);
  }
}
```

Chamar em `GetRepositoryGraphUseCase.execute` antes de qualquer contato com o ai-api. Auditar todo call site que monte `${owner}/${repo}` com `ownerOverride` do cliente e aplicar o mesmo.

Teste de regressão: usuário A indexa um repo; usuário B chama `GET /repositories/<repo>/graph?owner=A` e recebe 404, não o grafo.

---

## 2. Destruição de grafo entre usuários

`apps/ai-api/app/code_graph/cache.py`, `build_and_store`:

```
MATCH (n)
WHERE n.repoId = $repoId AND (n:Symbol OR n:ApiEndpoint)
DETACH DELETE n
```

Filtra por `repoId` e **ignora `sha`**. O lock é `idxlock:{repo_id}:{sha}` (`_lock_key`), portanto dois shas diferentes do mesmo repo indexam em paralelo sem se bloquear.

Consequência: o usuário B, indexando o mesmo `repoId` em outro sha, apaga o grafo que o usuário A está consultando. Perda de dado e corrida, não só ruído.

### Correção aplicada

1. o delete do alvo passou a filtrar por `(ownerId, repoId, sha)`, e a limpeza de shas antigos virou um passo separado **depois** da escrita;
2. a ordem virou escrever → apontar `RepoIndex` → descartar shas antigos. O grafo anterior continua legível durante todo o build, e a virada é o MERGE do `RepoIndex`. A ordem antiga deixava o repositório sem grafo por toda a duração da indexação;
3. o lock passou a ser `idxlock:{ownerId}:{repoId}` — serializa builds do mesmo repositório entre shas, sem serializar donos diferentes (que não colidem);
4. `MATCH` rotulado (`:Symbol`, `:ApiEndpoint`) em statements separados, em vez de varredura sem label;
5. escrita em lote com `UNWIND` — antes era uma query por símbolo e uma por aresta.

Travado por `test_lock_serializes_builds_of_the_same_repo_across_shas` e `test_reindex_by_one_owner_leaves_the_other_owner_graph_intact`.

---

## 3. Propriedade de dono nos nós — feito

`ownerId` (uuid do usuário do Cast) em `Symbol`, `ApiEndpoint` e `RepoIndex`, e incluí-lo em **toda** cláusula de match.

Pontos de mudança em `apps/ai-api/app/code_graph/cache.py`:

| Método | Mudança |
|---|---|
| `build_and_store` | recebe `owner_id`; grava em `Symbol`, `ApiEndpoint`, `RepoIndex`; delete filtra por `repoId` + `sha` + `ownerId` |
| `get_latest_sha` | filtra `RepoIndex` por `ownerId` |
| `list_repositories` | filtra por `ownerId`; hoje devolve **todo** repoId indexado globalmente |
| `lookup` | filtra `Symbol` e as duas pontas das arestas por `ownerId` |
| `_list_endpoints_in_session` | filtra por `ownerId` |
| `materialize_project_graph` | `projectId` já isola as arestas `CONSUMES`, mas os `ApiEndpoint` casados precisam do mesmo `ownerId` |

Criados em `ensure_graph_indexes`, chamada no startup do ai-api (`app/main.py`):

```cypher
CREATE INDEX symbol_scope IF NOT EXISTS
  FOR (n:Symbol) ON (n.ownerId, n.repoId, n.sha);
CREATE INDEX endpoint_scope IF NOT EXISTS
  FOR (n:ApiEndpoint) ON (n.ownerId, n.repoId, n.sha);
CREATE INDEX repoindex_scope IF NOT EXISTS
  FOR (n:RepoIndex) ON (n.ownerId, n.repoId);
```

Nota de custo: um mesmo repositório indexado por dois usuários passa a ocupar duas cópias do grafo. É o preço do isolamento nesta topologia. A alternativa — grafo compartilhado com lista de leitores — reintroduz a necessidade de revalidar permissão a cada leitura, que é justamente o que a seção 5 já exige. Preferir a cópia por dono; é mais simples de auditar.

### `list_repositories` merece destaque

Hoje devolve todo `repoId` do banco, e a filtragem por dono acontece só no Nest, em `src/modules/repositories/repositories.service.ts:127-141`, cruzando com os repositórios do GitHub do usuário. Um único check de aplicação separa nomes de repositório privado de todos os tenants. Com `ownerId` no `RepoIndex`, a filtragem passa a ser defesa em profundidade em vez de barreira única.

Nota secundária no mesmo trecho: o laço `while (selected.length < limit)` pagina o catálogo inteiro do Neo4j quando o usuário tem poucos repositórios acessíveis. Limitar o número de páginas.

---

## 4. Fechar as rotas de conteúdo do ai-api

`GET /index/file` e `GET /index/files` (`apps/ai-api/app/api/routes/chat.py:48` e `:63`) aceitam `repoId` e `sha` arbitrários e devolvem **conteúdo de código**. A única barreira é o `AI_SERVICE_TOKEN`.

Hoje o caminho real é seguro por acidente de composição: o chat resolve `thread.scope.repositories` a partir do catálogo (que é verificado) e a thread é escopada por `userId`. Mas a rota em si não tem nada.

Correção: aplicar o mesmo padrão já usado no catálogo — `ChatCatalogGrantService` (`src/modules/chat/chat-catalog-grant.service.ts`) emite um grant HMAC de vida curta com o usuário e a thread. Estender esse grant para carregar o escopo de repositórios autorizado, e exigir sua apresentação em `/index/file` e `/index/files`. O token de serviço passa a autenticar o serviço; o grant passa a autorizar o conteúdo.

---

## 5. Revalidação de permissão

`thread.scope.repositories` é persistido. Se o acesso do usuário ao repositório for revogado no GitHub depois da criação da thread, nada revalida.

Definir um TTL de escopo — reusar `GRANT_TTL_MS` (300_000) como referência — e revalidar contra o GitHub na emissão de cada grant, não só na criação da thread.

---

## 6. Higiene de produção

- `NEO4J_dbms_security_procedures_unrestricted: "gds.*"` e o volume `.neo4j-plugins` no `docker-compose.yml` são de desenvolvimento. Não levar para produção.
- Credencial do runtime do ai-api deve ser um usuário Neo4j dedicado, sem privilégio administrativo, e não o `neo4j` padrão.
- Já está correto e deve ser mantido: `apps/ai-api/app/config/settings.py` exige esquema TLS em `NEO4J_URI` e rejeita a senha default em produção.
- Já está correto: não há injeção de Cypher. Todas as queries são parametrizadas; a única interpolação de f-string é `rel_type`, vinda do dicionário fixo `RELATIONSHIP_TYPE_BY_KIND`. Manter essa propriedade — nunca interpolar valor de entrada em Cypher.

---

## O que falta

1. **Reindexação do acervo existente.** Os nós gravados antes desta mudança não têm `ownerId`, então nenhuma query os alcança — na prática ficaram órfãos. Não há perda de dado de negócio (o grafo é derivado do código), mas cada repositório precisa ser reindexado. Alternativa: um script que atribua `ownerId` a partir de quem enfileirou a última indexação, se esse histórico ainda existir.
2. Seção 4 — grant nas rotas de conteúdo (`/index/file`, `/index/files`).
3. Seção 5 — revalidação de permissão do GitHub no escopo de thread.
4. Seção 6 — higiene de produção (usuário Neo4j dedicado, tirar `gds.*` irrestrito e o volume de plugins).
