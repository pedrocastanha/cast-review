# Tasks — Code Graph / Repo Map

**Design**: `.specs/features/code-graph-context/design.md`
**Spec**: `.specs/features/code-graph-context/spec.md`
**Testing**: `.specs/codebase/TESTING.md` (linhas `code_graph` pure logic / cache+endpoints já adicionadas)
**Status**: Fases A-E implementadas (T1-T27 completo). Ver `docs/feature-code-graph-context/ADR.md` pra decisões de implementação, achados testando (incluindo 1 bug pego só navegando a app real no Chrome, Decisão E4) e ideias futuras registradas (não implementadas, adiadas por decisão do usuário). Nada commitado.

---

## Plano de execução

### Fase A — Núcleo de indexação (ai-api, grafo completo)

```
T1 [P] ─┐
T2 [P] ─┴→ T3 → T4 ──┬→ T5 [P] ─┐
                       ├→ T6 [P] ─┼→ T8
                       └→ T7 ─────┘
```

### Fase B — Disparo de indexação (backend + frontend)

```
T9 [P] ──→ T10 ──→ T11 [P]
(T10 também depende de T8, join entre Fase A e B)
```

### Fase C — Consulta (grafo já indexado → contexto de review)

```
T7 → T12 → T13 ──┬→ T14 ──┬→ T15
      T6 ─────────┘        └→ T16 → T17
                                  └→ T18
```

### Fase D — Reindex incremental + status

```
T7 → T19
T4 → T20 [P]
T8, T10 → T21 → T22 [P]
```

### Fase E — Visualização do grafo (P6)

```
T7 → T23 → T24 → T25 → T26 → T27
                              (T22 também alimenta T27, CTA reusa status)
```

---

## Task Breakdown

### T1: Dependências tree-sitter + queries `.scm` [P]

**What**: Adiciona `tree-sitter` + `tree-sitter-language-pack` ao `requirements.txt`; queries `.scm` pra TS/JS e Python
**Where**: `apps/ai-api/requirements.txt`, `apps/ai-api/app/code_graph/queries/typescript.scm`, `python.scm`
**Depends on**: None
**Reuses**: nada — dependência nova
**Requirement**: CGC-02 (pré-requisito)

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] `pip install -r requirements.txt` sem erro
- [ ] `python -c "import tree_sitter_language_pack"` roda sem exceção
- [ ] Queries cobrem: TS/JS → `function_declaration`, `class_declaration`, `method_definition`, `call_expression`, `import_statement`; Python → `function_definition`, `class_definition`, `call`, `import_statement`, `import_from_statement`

**Tests**: none (config, sem lógica)
**Gate**: `cd apps/ai-api && pytest -m "not integration"`

**Commit**: `chore(ai-api): add tree-sitter deps and query skeletons`

---

### T2: Modelos de dado `code_graph` [P]

**What**: `Symbol`, `Edge`, `ParsedSymbols`, `Graph`, `SymbolRef`, `IndexStats`, `RelatedContext`, `IndexResult` como pydantic models
**Where**: `apps/ai-api/app/code_graph/models.py`
**Depends on**: None
**Reuses**: shape espelha `ChangedFileContext` (`apps/backend/src/shared/types.ts:17-22`)
**Requirement**: CGC-02, CGC-04, CGC-10, CGC-19

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Todos os modelos do design.md definidos com os campos exatos (incluindo `IndexStats.indexed`/`stale`, `RelatedContext.dead_code_candidates`)
- [ ] Validação pydantic rejeita `kind` fora do enum

**Tests**: unit
**Gate**: `cd apps/ai-api && pytest -m "not integration"`

**Commit**: `feat(ai-api): add code_graph pydantic models`

---

### T3: `indexer.py` — parse + resolução de import

**What**: `parse_file()` (extração via tree-sitter) e `resolve_import()` (relativo → alias → fallback nome único)
**Where**: `apps/ai-api/app/code_graph/indexer.py`
**Depends on**: T1, T2
**Reuses**: nada — extração regex do TS não é reaproveitável
**Requirement**: CGC-02, CGC-05

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] `parse_file` retorna `ParsedSymbols` corretos pra fixture TS/JS/Python
- [ ] `resolve_import` resolve relativo, alias (`tsconfig.json#paths`, `pyproject.toml`), fallback nome único
- [ ] Símbolo ambíguo (2+ arquivos, mesmo nome, sem módulo compartilhado) → `resolve_import` retorna `None`, não adivinha

**Tests**: unit (fixtures em `apps/ai-api/tests/fixtures/code_graph/`)
**Gate**: `cd apps/ai-api && pytest -m "not integration"`

**Commit**: `feat(ai-api): implement tree-sitter indexer with import resolution`

---

### T4: `graph.py` — grafo completo

**What**: `build_graph()` monta grafo completo (`defines/references/imports/tests`) a partir de **todos** os arquivos do repo (não só PR); `detect_test_edges()` casa arquivo de teste com símbolo referenciado
**Where**: `apps/ai-api/app/code_graph/graph.py`
**Depends on**: T3
**Reuses**: `code_graph.models.Graph/Edge`
**Requirement**: CGC-02, CGC-09

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Fixture com 3 arquivos em call chain (`A→B→C`): grafo tem aresta `references` de `A` e `B` apontando pra `C`, mesmo sem relação de import direta entre `A` e `C`
- [ ] `detect_test_edges` casa `**/*.spec.*`, `**/*.test.*`, `**/tests/**`, `test_*.py`

**Tests**: unit
**Gate**: `cd apps/ai-api && pytest -m "not integration"`

**Commit**: `feat(ai-api): build full repo symbol graph`

---

### T5: Pular arquivo com falha de parse, sem abortar indexação [P]

**What**: Envolve `parse_file` em `try/except` por arquivo dentro do pipeline de indexação; falha marca `stats.skipped_files += 1` e segue pro próximo arquivo
**Where**: `apps/ai-api/app/code_graph/indexer.py` (função de orquestração `index_files`, nova)
**Depends on**: T4
**Reuses**: `parse_file`/`build_graph` como estão
**Requirement**: CGC-03, CGC-04

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Fixture com 1 arquivo de sintaxe inválida entre 5 válidos: indexação completa, 4 no grafo, `stats.skipped_files == 1`
- [ ] Exceção nunca propaga pra fora de `index_files`

**Tests**: unit
**Gate**: `cd apps/ai-api && pytest -m "not integration"`

**Commit**: `feat(ai-api): skip unparseable files without aborting indexing`

---

### T6: `deadcode.py` — candidatos + heurística de entrypoint [P]

**What**: `find_dead_candidates()` acha símbolos com in-degree 0 em `references`; exclui entrypoints (export de pacote, decorator de rota conhecido, `main`, só-referenciado-por-teste)
**Where**: `apps/ai-api/app/code_graph/deadcode.py`
**Depends on**: T4
**Reuses**: `Graph` completo
**Requirement**: CGC-17, CGC-18

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Fixture com função sem nenhum caller → aparece em candidatos
- [ ] Fixture com rota decorada (`@Controller`/`@Get` ou FastAPI `@router.get`) sem caller interno → **não** aparece (entrypoint)
- [ ] Fixture com símbolo só referenciado por arquivo de teste → sinalizado separado de "morto de verdade" (campo/flag distinto, não mesmo bucket)
- [ ] Lista de padrões de entrypoint é config, não hardcoded inline (extensível)

**Tests**: unit
**Gate**: `cd apps/ai-api && pytest -m "not integration"`

**Commit**: `feat(ai-api): detect dead code candidates with entrypoint exclusion`

---

### T7: `cache.py` — persistência em Neo4j, leitura, lock em Redis

**What**: `build_and_store()` (apaga nós antigos do `repo@sha` e recria via Cypher `CREATE` — cada `Symbol` vira nó `:Symbol`, cada `Edge` vira relacionamento tipado `:REFERENCES`/`:IMPORTS`/`:DEFINES`/`:TESTS`, tageados `repoId`/`sha`), `lookup()` (Cypher `MATCH` reconstrói `Graph` pydantic, `None` se ausente), `acquire_lock()`/`release_lock()` (Redis `SETNX`+TTL, evita indexação concorrente duplicada)
**Where**: `apps/ai-api/app/code_graph/cache.py`
**Depends on**: T4
**Reuses**: nada do grafo em si (Neo4j é infra nova — decisão tomada em sessão de revisão de design, ver `docs/feature-code-graph-context/ADR.md` Decisão A12); conexão Redis existente (`REDIS_URL`, `main.py:4,14`) só pro lock, namespace `idxlock:*` isolado do checkpoint LangGraph
**Requirement**: CGC-02 (persistência), caso de borda de lock do spec

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] `build_and_store` grava, `lookup` do mesmo `repo@sha` recupera grafo idêntico (real Neo4j)
- [ ] `lookup` de `repo@sha` nunca indexado retorna `None`, não lança exceção
- [ ] Rebuild do mesmo `repo@sha` é idempotente (não duplica nó/relacionamento)
- [ ] Dois repos diferentes não vazam nó um pro outro (filtro por `repoId` funciona)
- [ ] `acquire_lock` chamado 2x em paralelo pro mesmo `repo@sha`: segunda chamada recebe `False` (lock já detido)
- [ ] Neo4j indisponível: `build_and_store` levanta erro explícito (não é caso de degradar — sem onde persistir)

**Tests**: integration (real Neo4j + real Redis, `@pytest.mark.integration`)
**Gate**: `docker compose up -d redis postgres neo4j && cd apps/ai-api && pytest`

**Commit**: `feat(ai-api): add repo@sha graph cache in Neo4j with Redis concurrency lock`

---

### T8: `POST /index/build`

**What**: Router FastAPI que recebe `{repoId, sha, files}`, roda `index_files` (T5) + `build_graph` (T4) + `build_and_store` (T7) com lock, retorna `{indexId, stats}`. Lê `neo4j_driver`/`index_redis` de `request.app.state` (singletons criados no lifespan de `main.py`, não uma conexão nova por request)
**Where**: `apps/ai-api/app/api/routes/index.py` (novo), registro em `main.py`
**Depends on**: T5, T6, T7
**Reuses**: padrão de router de `api/routes/agent.py`; padrão `request.app.state.graph` já usado por `agent.py` pros clients singleton
**Requirement**: CGC-02, CGC-03, CGC-04

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] `POST /index/build` com fixture de repo (real Neo4j + Redis) → `{indexId, stats: {indexedFiles, skippedFiles, durationMs}}`
- [ ] Chamada concorrente pro mesmo `repoId+sha` → segunda chamada recebe 409, não reprocessa (usa lock de T7)
- [ ] Rota exige lifespan da app rodando (`with TestClient(app)`, não `TestClient(app)` bare) — `app.state.neo4j_driver`/`.index_redis` só existem depois do lifespan

**Tests**: integration (real Neo4j + real Redis)
**Gate**: `docker compose up -d redis postgres neo4j && cd apps/ai-api && pytest`

**Commit**: `feat(ai-api): expose POST /index/build`

---

### T9: Backend — busca de árvore completa do repo [P]

**What**: `fetchRepoTree()` usa GitHub Trees API recursiva pra listar todo o repo, filtra extensões suportadas (`.ts/.tsx/.js/.jsx/.py`), busca conteúdo via `git.getBlob` por sha de blob
**Where**: `apps/backend/src/modules/repositories/helpers/tree-fetcher.helper.ts`
**Depends on**: None
**Reuses**: client Octokit já injetado em `RepositoriesService` (`repositories.service.ts:50-59`)
**Requirement**: CGC-01

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Fixture (Octokit mockado) com árvore de N arquivos, M com extensão suportada → retorna exatamente M `{path, content}`
- [ ] Repo com árvore truncada pela API (`truncated: true` da resposta do GitHub) é sinalizado, não silenciosamente incompleto

**Tests**: unit (Jest, Octokit mockado)
**Gate**: `cd apps/backend && npm run test`

**Commit**: `feat(backend): fetch full repo tree via GitHub Trees API`

---

### T10: Backend — fila BullMQ + `IndexProcessor` + `POST /repositories/:repo/index` (enqueue)

**What**: `BullModule.forRoot` (conexão pro Redis já existente) + `BullModule.registerQueue({name: 'code-index'})`; `IndexProcessor extends WorkerHost` faz o trabalho pesado (`fetchRepoTree` de T9 → `POST /index/build` via novo método `buildIndex` em `ai-api.client.ts` → `job.updateProgress`); `RepositoriesController` ganha endpoint que só enfileira (`queue.add('build', data, {jobId})`) e responde `202` na hora — não espera o job terminar. **Correção pós-design**: essa task nasceu como "chama ai-api e repassa stats síncrono"; virou fila assíncrona depois de discussão sobre repo de 1k+ arquivos estourar payload/timeout numa request só (ver design.md, "Correção pós-design")
**Where**: `apps/backend/src/modules/repositories/indexing/index.processor.ts` (novo), `repositories.module.ts` (registro da fila), `repositories.controller.ts`, `repositories.service.ts`, `apps/backend/src/shared/clients/ai/ai-api.client.ts` (novo método `buildIndex`)
**Depends on**: T9, T8
**Reuses**: padrão de `ai-api.client.ts:24` (`/agent/run`) e `:68` (`/agent/resume`) pro novo método `buildIndex`
**Requirement**: CGC-01, CGC-25

**Tools**: MCP: NONE / Skill: NONE
**Nota de implementação**: `@nestjs/bullmq@^11` (compatível com Nest 11 já no projeto) + `bullmq@^6`; confirmar antes de codar que `jobId` não contém `:` (restrição do BullMQ — usar `owner/repo@sha`, não `owner:repo:sha`)

**Done when**:
- [ ] `POST /repositories/:repo/index?owner=` responde `202 { jobId, status: 'queued' }` **sem** esperar `fetchRepoTree` nem a chamada ao `ai-api` terminarem (prova: mock de `fetchRepoTree` demorado, request retorna rápido mesmo assim)
- [ ] `IndexProcessor.process()` (ai-api mockado) roda `fetchRepoTree` → `buildIndex`, chama `job.updateProgress` pelo menos 2x
- [ ] Enfileirar 2x o mesmo `owner/repo@sha` rápido em sequência → só 1 job processado (dedupe nativo do BullMQ por `jobId` igual)
- [ ] Erro do GitHub (rate limit, repo não encontrado) dentro do processor → job marca `failed`, não trava a fila nem derruba o worker

**Tests**: unit (Jest, Octokit + ai-api client + `Queue` mockados — `IndexProcessor.process()` e `enqueueIndexJob` testados isolados) + integration (Jest, real Redis, só a mecânica de fila — dedupe por `jobId`, `*.integration.spec.ts`, excluído do `npm run test` default via `testPathIgnorePatterns`; ver TESTING.md "backend integration (BullMQ)")
**Gate**: `cd apps/backend && npm run test` (unit) + `docker compose up -d redis && npm run test:integration` (fila real)

**Commit**: `feat(backend): index repositories via async BullMQ job instead of blocking request`

---

### T11: Frontend — ação "Indexar repositório" [P]

**What**: Botão em `RepositoryCard.tsx` chamando nova mutation; `repositories.api.ts` ganha `indexRepository()` (retorna `{jobId, status: 'queued'}` na hora, não espera terminar); `useRepositories.ts` (ou hook novo) expõe estado `queued`/`indexing`/erro, pollando status (T21/T22) até `indexed`. Label do botão condicional ao status: "Indexar" se nunca indexado, "Atualizar" se já indexado — mesmo endpoint nos dois casos, backend/ai-api já decidem full-build vs incremental (T19) sozinhos por hash de arquivo
**Where**: `apps/frontend/src/components/repos/RepositoryCard.tsx`, `apps/frontend/src/api/repositories.api.ts`, `apps/frontend/src/hooks/useRepositories.ts`
**Depends on**: T10
**Reuses**: padrão de fetch já usado pelos outros hooks de `repositories.api.ts`
**Requirement**: CGC-01

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Botão dispara `POST /repositories/:repo/index`, recebe `202` na hora, mostra estado "na fila"/"indexando", troca pra "indexado" quando o polling de status (T21/T22) reporta `indexed`
- [ ] Build/lint passam

**Tests**: none (frontend — build gate)
**Gate**: `cd apps/frontend && npx tsc -b && npx oxlint`

**Commit**: `feat(frontend): add repository indexing action`

---

### T12: `ranker.py` — PageRank personalizado

**What**: `rank()` roda PageRank personalizado (peso 1.0 nos arquivos alterados) sobre grafo **lido do cache**, não reconstruído
**Where**: `apps/ai-api/app/code_graph/ranker.py`
**Depends on**: T7
**Reuses**: `cache.lookup` de T7
**Requirement**: CGC-07

**Tools**: MCP: NONE / Skill: NONE
**Nota**: avaliar `networkx.pagerank` primeiro; só escrever manual se overhead não compensar pro tamanho típico de grafo

**Done when**:
- [ ] Fixture com 2 callers em distâncias diferentes: mais próximo/mais referenciado ranka acima
- [ ] Aresta `references` de entrada pesa mais que `imports` (teste compara pesos invertidos)

**Tests**: unit
**Gate**: `cd apps/ai-api && pytest -m "not integration"`

**Commit**: `feat(ai-api): add personalized PageRank ranking over cached graph`

---

### T13: `budget.py` — alocação 60/30/10

**What**: `select()` aloca ~60% arquivos alterados (conteúdo completo), ~30% top vizinhos rankeados (corpo completo), ~10% cauda (só assinatura); nunca corta símbolo no meio; heurística de token `len(text)//4`
**Where**: `apps/ai-api/app/code_graph/budget.py`
**Depends on**: T12
**Reuses**: substitui `slice()` de `context-builder.helper.ts:115` e `graph/utils/files.py`
**Requirement**: CGC-08

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Proporção real fica dentro de tolerância da alocação 60/30/10 pra fixture com `tokenBudget` fixo
- [ ] `tokenBudget` menor que arquivos alterados sozinhos → prioriza changed files, zera vizinhos, `truncated=true`
- [ ] Símbolo que cabe só parcialmente é rebaixado pra assinatura, nunca corpo parcial

**Tests**: unit
**Gate**: `cd apps/ai-api && pytest -m "not integration"`

**Commit**: `feat(ai-api): full 60/30/10 token budget allocation`

---

### T14: Montagem de `RelatedContext` completo

**What**: Função de fachada `assemble_related_context()` combina saída de `budget.select` (T13) + `deadcode.find_dead_candidates` (T6) em `RelatedContext` completo, incluindo `IndexStats`
**Where**: `apps/ai-api/app/code_graph/context.py` (novo, função de fachada compartilhada por T15 e T16)
**Depends on**: T13, T6
**Reuses**: `RelatedContext`/`IndexStats` models (T2)
**Requirement**: CGC-10, CGC-19

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] `assemble_related_context(repo_id, sha, changed_files, token_budget)` retorna todos os 6 campos preenchidos pra fixture indexada
- [ ] Chamado pra `repo@sha` sem índice → retorna `RelatedContext` com listas vazias e `stats.indexed=false`, não exceção

**Tests**: unit
**Gate**: `cd apps/ai-api && pytest -m "not integration"`

**Commit**: `feat(ai-api): assemble complete RelatedContext (facade for route + node)`

---

### T15: `POST /index/context`

**What**: Router chamando `assemble_related_context` (T14) diretamente — endpoint standalone
**Where**: `apps/ai-api/app/api/routes/index.py` (modificado, adiciona rota)
**Depends on**: T14
**Reuses**: T14 sem reimplementar lógica
**Requirement**: CGC-20

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] `POST /index/context {repoId, sha, changedFiles, tokenBudget}` contra repo fixture já indexado (real Neo4j) → `relatedContext` correto
- [ ] `repoId+sha` nunca indexado → 200 com `stats.indexed=false`, não 404 nem 500 (é estado válido, não erro)

**Tests**: integration (real Neo4j)
**Gate**: `docker compose up -d redis postgres neo4j && cd apps/ai-api && pytest`

**Commit**: `feat(ai-api): expose POST /index/context`

---

### T16: `change_analyzer` consome índice (reescrito)

**What**: Remove qualquer lógica de parse/grafo do node; chama `assemble_related_context` (T14) diretamente, em processo (sem round-trip HTTP), trata `stats.indexed=false` como caminho normal
**Where**: `apps/ai-api/app/graph/nodes/change_analyzer` (modificado)
**Depends on**: T14
**Reuses**: T14
**Requirement**: CGC-06, CGC-12

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Run de análise pra repo indexado: `relatedContext.callers` populado, sem nenhuma chamada de parse dentro do node (prova via mock que `indexer.parse_file` nunca é chamado no caminho de análise)
- [ ] Run de análise pra repo **não indexado**: completa normalmente, `relatedContext` vazio, `stats.indexed=false`, nenhuma tentativa de indexar on-the-fly

**Tests**: unit
**Gate**: `cd apps/ai-api && pytest -m "not integration"`

**Commit**: `feat(ai-api): change_analyzer queries index instead of building it`

---

### T17: `files_block` consome `repoMap` + callers + dead code

**What**: Muda assinatura de `files_block` pra aceitar `repoMap`/`callers`/`deadCodeCandidates`; atualiza os 4 call sites
**Where**: `apps/ai-api/app/graph/utils/files.py`, + `architecture_reviewer/agent.py:77`, `prd/agent.py:28,84`, `test_reviewer/agent.py:101`, `implementation_spec/agent.py:29,32`
**Depends on**: T16
**Reuses**: `files_block` existente como base
**Requirement**: CGC-11

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Os 4 agentes recebem `repoMap`+callers+dead code candidates no prompt montado
- [ ] Prompt final não excede `MAX_PROMPT_TOTAL_CHARS`
- [ ] Suíte existente dos 4 agentes passa sem regressão

**Tests**: unit
**Gate**: `cd apps/ai-api && pytest -m "not integration"`

**Commit**: `feat(ai-api): wire repo map, callers and dead code into agent prompts`

---

### T18: Backend — tipo `ChangedFileContext.relatedContext`

**What**: Estende `ChangedFileContext` (TS) com `relatedContext` opcional, espelhando o shape Python; sem lógica nova, só tipo — o campo já chega pronto no resultado do `ai-api`
**Where**: `apps/backend/src/shared/types.ts`
**Depends on**: T16
**Reuses**: `ChangedFileContext` existente (`types.ts:17-22`)
**Requirement**: CGC-10 (lado TS)

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Tipo compila, campo é opcional (não quebra consumidores que só leem `relatedFiles`)

**Tests**: unit (type-check é o teste — sem lógica de runtime)
**Gate**: `cd apps/backend && npm run test`

**Commit**: `feat(backend): add relatedContext to ChangedFileContext type`

---

### T19: Reindexação incremental por hash

**What**: `cache.py` ganha `build_and_store` incremental — compara hash de conteúdo por arquivo contra índice existente, reparseia só os diferentes, reaproveita o resto do grafo
**Where**: `apps/ai-api/app/code_graph/cache.py` (modificado)
**Depends on**: T7
**Reuses**: `build_and_store`/`lookup` de T7 como base
**Requirement**: CGC-13, CGC-14

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Indexar repo, alterar 1 arquivo, reindexar (real Neo4j): só aquele arquivo é reparseado, resto reaproveitado — prova via contagem de chamadas a `parse_file`
- [ ] `stats` do reindex reporta `indexedFiles` (reparsados) e `reusedFiles` (reaproveitados) separados

**Tests**: integration (real Neo4j)
**Gate**: `docker compose up -d redis postgres neo4j && cd apps/ai-api && pytest`

**Commit**: `feat(ai-api): incremental reindexing by file content hash`

---

### T20: Limite de arquivos em repo grande [P]

**What**: `CODE_GRAPH_MAX_FILES` configurável em `settings.py`; indexação corta no limite, sinaliza `stats.truncated`
**Where**: `apps/ai-api/app/config/settings.py`, `apps/ai-api/app/code_graph/indexer.py` (checagem de limite)
**Depends on**: T4
**Reuses**: padrão de settings existente (`MAX_PROMPT_TOTAL_CHARS` etc.)
**Requirement**: CGC-15

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Repo fixture acima do limite: indexação para no limite, `stats.truncated=true`, não estoura tempo/memória (teste com timeout curto)

**Tests**: unit
**Gate**: `cd apps/ai-api && pytest -m "not integration"`

**Commit**: `feat(ai-api): enforce configurable file limit on indexing`

---

### T21: Backend — `GET /repositories/:repo/index/status`

**What**: Endpoint consulta status de indexação — 4 estados (`not_indexed`/`queued`/`indexing`/`indexed`). Primeiro checa se existe job ativo pra `jobId` determinístico (`owner/repo@sha` — precisa do `sha` atual do HEAD, buscado via Octokit; se job existe e não terminou, retorna `queued`/`indexing` + `job.progress`); senão, consulta `ai-api` (`get_latest_sha`, CGC-26) pra saber `indexed`/`not_indexed` + calcula `stale` comparando com o HEAD atual
**Where**: `apps/backend/src/modules/repositories/repositories.controller.ts`, `repositories.service.ts`
**Depends on**: T8, T10 (precisa da fila existir pra checar job ativo)
**Reuses**: `ai-api.client.ts` (mesmo client de T10), `@InjectQueue('code-index')` de T10
**Requirement**: CGC-16, CGC-26

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Repo com job ativo na fila → `{status: 'queued' | 'indexing', progress: number}`
- [ ] Repo indexado, sem job ativo, sha bate com HEAD → `{status: 'indexed', sha, stale: false}`
- [ ] Repo indexado, sha do índice difere do HEAD atual → `{status: 'indexed', sha, stale: true}`
- [ ] Repo nunca indexado, sem job ativo → `{status: 'not_indexed', sha: null, stale: false}`

**Tests**: unit (Jest, client + queue mockados)
**Gate**: `cd apps/backend && npm run test`

**Commit**: `feat(backend): add repository index status endpoint with job-aware state`

---

### T22: Frontend — badge de status de indexação [P]

**What**: `RepositoryCard.tsx` mostra badge (não indexado / na fila / indexando (%) / indexado / desatualizado) consultando T21 via polling curto (poucos segundos) enquanto `queued`/`indexing`, parando de pollar em `indexed`/`not_indexed`
**Where**: `apps/frontend/src/components/repos/RepositoryCard.tsx`, `useRepositories.ts`
**Depends on**: T21
**Reuses**: hook/API pattern de T11
**Requirement**: CGC-16

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Badge reflete os 4 estados corretamente pra fixture de resposta da API, incluindo progresso numérico durante `indexing`
- [ ] Build/lint passam

**Tests**: none (frontend — build gate)
**Gate**: `cd apps/frontend && npx tsc -b && npx oxlint`

**Commit**: `feat(frontend): show repository index status badge`

---

### T23: `viz.py` — serialização agregada + expansão de vizinhança

**What**: `serialize_overview()` agrega grafo por diretório/módulo quando acima de `max_nodes`; `expand_neighborhood()` retorna vizinhança de um nó foco até `depth` saltos
**Where**: `apps/ai-api/app/code_graph/viz.py`
**Depends on**: T7
**Reuses**: `cache.lookup` (T7), `Graph`/`Symbol`/`Edge` models (T2)
**Requirement**: CGC-21, CGC-22, CGC-23

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Fixture com >200 nós: `serialize_overview` retorna visão agregada por diretório, não 200 nós soltos
- [ ] `expand_neighborhood(focus_id, depth=1)` retorna só a vizinhança direta do nó, não o grafo inteiro

**Tests**: unit
**Gate**: `cd apps/ai-api && pytest -m "not integration"`

**Commit**: `feat(ai-api): add graph serialization for visualization`

---

### T24: `GET /index/graph`

**What**: Rota expõe `viz.py` — `overview` por padrão, `focus`+`depth` pra expansão
**Where**: `apps/ai-api/app/api/routes/index.py` (nova rota)
**Depends on**: T23
**Reuses**: mesmo router de `/index/build`/`/index/context`
**Requirement**: CGC-21, CGC-24

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] `GET /index/graph?repoId=&sha=` (real Neo4j, repo indexado) → `VizGraph` agregado
- [ ] Repo não indexado → `stats.indexed=false`, não erro

**Tests**: integration (real Neo4j)
**Gate**: `docker compose up -d redis postgres neo4j && cd apps/ai-api && pytest`

**Commit**: `feat(ai-api): expose GET /index/graph`

---

### T25: Backend — `GET /repositories/:repo/graph`

**What**: Passthrough do endpoint de visualização do `ai-api`
**Where**: `apps/backend/src/modules/repositories/repositories.controller.ts`, `repositories.service.ts`
**Depends on**: T24
**Reuses**: `ai-api.client.ts` (mesmo client de T10/T21)
**Requirement**: CGC-21

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] `GET /repositories/:repo/graph?owner=&focus=&depth=` repassa query params e resposta do `ai-api` sem transformação

**Tests**: unit (Jest, client mockado)
**Gate**: `cd apps/backend && npm run test`

**Commit**: `feat(backend): add repository graph endpoint`

---

### T26: Frontend — `RepoGraphPage.tsx`

**What**: Adiciona `@xyflow/react`; página renderiza visão agregada inicial, clique em nó chama `expand_neighborhood` via T25 e adiciona ao canvas
**Where**: `apps/frontend/src/pages/RepoGraphPage.tsx` (novo), `apps/frontend/package.json` (nova dep)
**Depends on**: T25
**Reuses**: padrão de hook de `useRepositories.ts` pra loading/erro
**Requirement**: CGC-21, CGC-22, CGC-23

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Página renderiza grafo agregado a partir da resposta de T25
- [ ] Clicar num nó expande vizinhança sem recarregar o grafo inteiro
- [ ] Build/lint passam

**Tests**: none (frontend — build gate)
**Gate**: `cd apps/frontend && npx tsc -b && npx oxlint`

**Commit**: `feat(frontend): add interactive repo graph visualization`

---

### T27: Frontend — rota + CTA de indexação

**What**: Liga `RepoGraphPage` na navegação (a partir de `RepositoryCard.tsx`/página do repo); quando `stats.indexed=false`, mostra CTA reusando o fluxo de indexação de T11 em vez da tela de grafo
**Where**: `apps/frontend/src/components/repos/RepositoryCard.tsx`, roteamento (`react-router-dom`)
**Depends on**: T26, T22
**Reuses**: ação de indexar de T11, badge de status de T22
**Requirement**: CGC-24

**Tools**: MCP: NONE / Skill: NONE

**Done when**:
- [ ] Repo indexado: link/botão "ver grafo" leva pra `RepoGraphPage`
- [ ] Repo não indexado: mesmo ponto de entrada mostra CTA de indexar, não a tela de grafo vazia/quebrada

**Tests**: none (frontend — build gate)
**Gate**: `cd apps/frontend && npx tsc -b && npx oxlint`

**Commit**: `feat(frontend): wire graph view navigation with index CTA`

---

## Mapa de execução paralela

```
Fase A:
  T1 [P] ──┐
  T2 [P] ──┴→ T3 ──→ T4 ──┬→ T5 [P] ─┐
                            ├→ T6 [P] ─┼→ T8
                            └→ T7 ─────┘

Fase B:
  T9 [P] ──→ T10 (junta com T8) ──→ T11 [P]

Fase C:
  T7 ──→ T12 ──→ T13 ──┐
  T6 ───────────────────┴→ T14 ──┬→ T15
                                   └→ T16 ──→ T17
                                          └→ T18

Fase D:
  T7 ──→ T19
  T4 ──→ T20 [P]
  T8 ──→ T21 ──→ T22 [P]

Fase E:
  T7 ──→ T23 ──→ T24 ──→ T25 ──→ T26 ──→ T27
  T22 ───────────────────────────────────┘
```

**Restrição de paralelismo**: T5/T6/T7 partem todos de T4, tocam arquivos diferentes, sem estado mutável compartilhado → `[P]` válido entre si. T7, T8, T15, T16 (integration via T14→cache real), T19, T24 usam Neo4j real (+ Redis real pro lock, T7/T8) (`integration`) — não rodam ao mesmo tempo que outro teste `integration` no mesmo pytest run, mesmo quando `[P]` na árvore de dependência lógica.

---

## Checagem de granularidade

| Task | Escopo | Status |
|---|---|---|
| T1 | 1 config + 2 skeletons | ✅ Granular |
| T2 | 1 arquivo, 8 modelos coesos | ✅ Granular |
| T3 | 1 arquivo, 2 funções coesas | ✅ Granular |
| T4 | 1 função (+ helper de teste-edge) | ✅ Granular |
| T5 | 1 função de orquestração | ✅ Granular |
| T6 | 1 arquivo, 1 função + heurística | ✅ Granular |
| T7 | 1 arquivo, 3 funções coesas (mesmo cache) | ✅ Granular |
| T8 | 1 rota | ✅ Granular |
| T9 | 1 função | ✅ Granular |
| T10 | 1 endpoint + 1 método de client | ✅ Granular (mudança de interface única) |
| T11 | 1 botão + 1 chamada de API + wiring de hook | ✅ Granular |
| T12 | 1 função | ✅ Granular |
| T13 | 1 função | ✅ Granular |
| T14 | 1 função de fachada | ✅ Granular |
| T15 | 1 rota | ✅ Granular |
| T16 | 1 node modificado | ✅ Granular |
| T17 | 1 função + 4 call sites (ripple mecânico de 1 mudança de assinatura) | ✅ Granular (coeso) |
| T18 | 1 tipo | ✅ Granular |
| T19 | 1 função estendida | ✅ Granular |
| T20 | 1 setting + 1 checagem | ✅ Granular |
| T21 | 1 endpoint | ✅ Granular |
| T22 | 1 componente de UI | ✅ Granular |
| T23 | 1 arquivo, 2 funções coesas (mesma serialização) | ✅ Granular |
| T24 | 1 rota | ✅ Granular |
| T25 | 1 endpoint passthrough | ✅ Granular |
| T26 | 1 página + 1 dep nova | ✅ Granular |
| T27 | 1 wiring de rota + 1 CTA condicional | ✅ Granular |

---

## Cross-check diagrama vs definição

| Task | Depends on (corpo) | Diagrama mostra | Status |
|---|---|---|---|
| T1 | None | Sem seta de entrada | ✅ |
| T2 | None | Sem seta de entrada | ✅ |
| T3 | T1, T2 | T1→T3, T2→T3 | ✅ |
| T4 | T3 | T3→T4 | ✅ |
| T5 | T4 | T4→T5 | ✅ |
| T6 | T4 | T4→T6 | ✅ |
| T7 | T4 | T4→T7 | ✅ |
| T8 | T5, T6, T7 | T5→T8, T6→T8, T7→T8 | ✅ |
| T9 | None | Sem seta de entrada | ✅ |
| T10 | T9, T8 | T9→T10, T8→T10 (join Fase A/B) | ✅ |
| T11 | T10 | T10→T11 | ✅ |
| T12 | T7 | T7→T12 | ✅ |
| T13 | T12 | T12→T13 | ✅ |
| T14 | T13, T6 | T13→T14, T6→T14 | ✅ |
| T15 | T14 | T14→T15 | ✅ |
| T16 | T14 | T14→T16 | ✅ |
| T17 | T16 | T16→T17 | ✅ |
| T18 | T16 | T16→T18 | ✅ |
| T19 | T7 | T7→T19 | ✅ |
| T20 | T4 | T4→T20 | ✅ |
| T21 | T8, T10 | T8→T21, T10→T21 | ✅ |
| T22 | T21 | T21→T22 | ✅ |
| T23 | T7 | T7→T23 | ✅ |
| T24 | T23 | T23→T24 | ✅ |
| T25 | T24 | T24→T25 | ✅ |
| T26 | T25 | T25→T26 | ✅ |
| T27 | T26, T22 | T26→T27, T22→T27 | ✅ |

---

## Validação de co-localização de testes

| Task | Camada criada/modificada | Matriz exige | Task diz | Status |
|---|---|---|---|---|
| T1 | config (sem lógica) | — | none | ✅ OK |
| T2 | ai-api code_graph pure logic | unit | unit | ✅ OK |
| T3 | ai-api code_graph pure logic | unit | unit | ✅ OK |
| T4 | ai-api code_graph pure logic | unit | unit | ✅ OK |
| T5 | ai-api code_graph pure logic | unit | unit | ✅ OK |
| T6 | ai-api code_graph pure logic | unit | unit | ✅ OK |
| T7 | ai-api code_graph cache + endpoints (Neo4j + Redis) | integration | integration | ✅ OK |
| T8 | ai-api code_graph cache + endpoints (Neo4j + Redis) | integration | integration | ✅ OK |
| T9 | Nest services/controllers | unit | unit | ✅ OK |
| T10 | Nest services/controllers + Nest BullMQ queue/processor | unit + integration | unit + integration | ✅ OK |
| T11 | Frontend components | none | none | ✅ OK |
| T12 | ai-api code_graph pure logic | unit | unit | ✅ OK |
| T13 | ai-api code_graph pure logic | unit | unit | ✅ OK |
| T14 | ai-api code_graph pure logic | unit | unit | ✅ OK |
| T15 | ai-api code_graph cache + endpoints (Neo4j + Redis) | integration | integration | ✅ OK |
| T16 | ai-api graph nodes / pure logic | unit | unit | ✅ OK |
| T17 | ai-api graph nodes / pure logic | unit | unit | ✅ OK |
| T18 | Nest services/controllers (tipo, sem runtime) | unit | unit | ✅ OK |
| T19 | ai-api code_graph cache + endpoints (Neo4j + Redis) | integration | integration | ✅ OK |
| T20 | ai-api code_graph pure logic | unit | unit | ✅ OK |
| T21 | Nest services/controllers | unit | unit | ✅ OK |
| T22 | Frontend components | none | none | ✅ OK |
| T23 | ai-api code_graph pure logic | unit | unit | ✅ OK |
| T24 | ai-api code_graph cache + endpoints (Neo4j + Redis) | integration | integration | ✅ OK |
| T25 | Nest services/controllers | unit | unit | ✅ OK |
| T26 | Frontend components | none | none | ✅ OK |
| T27 | Frontend components | none | none | ✅ OK |

Nenhuma violação. Nenhum "testado em outra task" usado como desculpa.

---

## Ferramentas por task

Ferramentas de arquivo/terminal padrão (leitura, edição, pytest/jest) bastam pra todas. Sem MCP externo necessário. Antes de executar T1/T3/T12: confirmar se algum MCP de documentação (ex. Context7) deve ser usado explicitamente pra consultar API do tree-sitter/networkx, já que são bibliotecas novas nesse repo.
