# Isolamento no Neo4j

Data: 2026-09-09. Cobre a pendência 2 de `IMPLEMENTATION.md` na parte de grafo.

## Estado

| Seção | Situação |
|---|---|
| 1. Leitura cross-tenant do grafo | **Corrigido.** `assertRepositoryAccess` + 4 testes de regressão |
| 2. Destruição de grafo entre usuários | **Corrigido.** delete por sha, lock por (dono, repo), MATCH rotulado, escrita antes da virada |
| 3. `ownerId` nos nós | **Feito.** Propagado por ai-api e backend; 5 testes de isolamento contra Neo4j real |
| 4. Grant nas rotas de conteúdo | **Feito.** Grant HMAC ligado a (dono, repo, sha), 17 testes |
| 5. Revalidação de permissão | **Feito.** `ChatScopeRevalidator`, 10 testes |
| 6. Higiene de produção | **Feito.** Allowlist de procedures, usuário dedicado exigido, script de limpeza |

Suites: 370 testes Python, 647 unitários do backend, 80 e2e.

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

## 4. Rotas de conteúdo do ai-api — feito

`GET /index/file` e `GET /index/files` devolvem **conteúdo de código** e aceitavam `repoId`/`sha` arbitrários, com o `AI_SERVICE_TOKEN` como única barreira. O token autentica o SERVIÇO; ele não autoriza CONTEÚDO.

Agora as duas rotas exigem um grant de escopo no header `X-Index-Scope`, além do bearer:

- **emissão** — `src/shared/security/index-scope-grant.ts`. O backend assina `{ownerId, repositories: [{repoId, sha}], expiresAt}` com HMAC-SHA256, TTL de 5 min, e só inclui o que acabou de revalidar no GitHub (seção 5);
- **verificação** — `apps/ai-api/app/index_scope.py`. Confere assinatura em tempo constante, expiração, `ownerId` e a presença exata do par `(repoId, sha)` pedido.

**Chave de assinatura.** Derivada do `AI_SERVICE_TOKEN` com separação de domínio (`HMAC(token, "index-scope-grant-v1")`), não um segredo novo. Os dois serviços já compartilham e já validam esse token em produção, então não há configuração adicional; derivar evita usá-lo cru como chave HMAC. `SECRET_ENCRYPTION_KEY` foi descartada de propósito — o ai-api não deve tê-la.

Ligar `ownerId` ao grant é o que impede que ele vire chave-mestra: um grant do usuário A não serve para ler o grafo de B, mesmo com o token de serviço em mãos.

Coberto por `tests/test_index_scope_grant.py` (11 casos: grant ausente, assinado com outro token, expirado, payload adulterado, dono trocado, repo fora do escopo, sha diferente) e `index-scope-grant.spec.ts` (6).

---

## 5. Revalidação de permissão — feito

`chat_threads.scope` é gravado na criação da thread, quando a permissão foi de fato verificada. Depois disso nada revalidava: um usuário removido de um repositório continuava lendo o grafo indexado dele por uma thread antiga.

`ChatScopeRevalidator` (`src/modules/chat/chat-scope-revalidator.ts`) revalida contra o GitHub nos três pontos que consomem o escopo persistido:

| Ponto | Efeito |
|---|---|
| `sendMessage` | repositórios sem acesso saem do escopo do run; escopo vazio recusa a mensagem |
| `listFiles` | listagem só cobre o que ainda é autorizado |
| `resolveMentions` | menção a repositório revogado é descartada |

TTL de 5 min (`SCOPE_REVALIDATION_TTL_MS`), igual ao do grant de catálogo — é o teto de defasagem aceito. O cache é por processo e existe por necessidade, não por latência: sem ele, uma thread de projeto com N repositórios faria N chamadas ao GitHub por mensagem.

**Falha fechada**: qualquer erro na verificação nega. Falhar aberto devolveria exatamente o acesso que a revalidação corta.

Coberto por `chat-scope-revalidator.spec.ts` (8 casos) e dois testes de revogação em `chat.service.spec.ts`.

---

## 6. Higiene de produção — feito

### Sandbox de procedures estreitado

`gds.*` liberava a biblioteca inteira do Graph Data Science sem sandbox. O ranker chama exatamente cinco procedures (`app/code_graph/ranker.py`):

```
gds.graph.project   gds.graph.exists   gds.graph.drop
gds.pageRank.stream gds.util.asNode
```

`docker-compose.yml` agora lista só essas em `unrestricted`, e adiciona um `allowlist` explícito com as mesmas. Verificado com o Neo4j real: as suites de ranker, contexto e cache passam; `gds.graph.list`, que nenhuma parte da aplicação usa, deixou de ser chamável — o teste de limpeza de projeção foi reescrito para asserir via `gds.graph.exists`, passando pelo mesmo portão que produção.

### Usuário dedicado

`validate_production_config` passa a recusar `NEO4J_USER=neo4j` em produção.

**O que isso compra, exatamente:** Community 5.26 aceita `CREATE USER` mas **não tem RBAC** — `SHOW ROLES` é "Unsupported administration command", e todo usuário é efetivamente admin do banco. Confirmado no servidor em uso. Portanto isto é **separação de credencial, não de privilégio**: a credencial da aplicação pode ser rotacionada ou revogada sem mexer na conta `neo4j`, que é a que administra auth e configuração do servidor. Não trate como fronteira de privilégio; a fronteira continua sendo o `ownerId` e a autorização na borda.

### Plugin do GDS

O bind-mount `./.neo4j-plugins` entrega um jar de 64 MB do disco do host, sem verificação de integridade nem versão fixada na imagem. Em produção o plugin deve ser embutido numa imagem versionada. O `docker-compose.yml` está marcado como desenvolvimento apenas.

### Já correto, manter

- `settings.py` exige esquema TLS em `NEO4J_URI` e rejeita a senha default.
- Não há injeção de Cypher: todas as queries são parametrizadas, e a única interpolação de f-string é `rel_type`, vinda do dicionário fixo `RELATIONSHIP_TYPE_BY_KIND`. Nunca interpolar valor de entrada em Cypher.

## 7. Limpeza do acervo órfão

Nós gravados antes do escopo por dono não têm `ownerId` e nenhuma query os alcança — toda leitura passou a exigi-lo. São lixo inacessível, não dado perdido: o grafo é derivado do código e volta com uma reindexação normal.

`apps/ai-api/scripts/cleanup_orphan_graph.py`:

```bash
python scripts/cleanup_orphan_graph.py                       # só relata
python scripts/cleanup_orphan_graph.py --repo owner/nome --apply
python scripts/cleanup_orphan_graph.py --apply               # tudo
```

`--repo` permite limpar e reindexar um repositório por vez em vez de esvaziar o acervo de uma vez. A deleção é em lotes de 10 mil — um `DETACH DELETE` sem limite num acervo grande segura a transação inteira em memória.

A condição `ownerId IS NULL` é o que define órfão e nunca deve ser removida: sem ela o script apagaria grafo vivo.

Verificado contra o Neo4j real: com nós órfãos e nós com dono no mesmo banco, o `--apply` escopado removeu apenas os órfãos do repositório alvo e deixou intactos tanto os nós com dono quanto o restante do acervo.

---

## O que falta

Só operação:

1. Rodar `cleanup_orphan_graph.py --apply` e reindexar os repositórios. **Não executado**: são 3.487 nós órfãos no Neo4j de desenvolvimento, e apagar é decisão do mantenedor. O modo relatório e o `--apply` escopado por repositório já foram exercitados.
2. Provisionar o usuário Neo4j dedicado e apontar `NEO4J_USER` para ele — sem isso o serviço recusa subir em produção.
3. Empacotar o GDS numa imagem versionada e remover o bind-mount do compose de produção.
