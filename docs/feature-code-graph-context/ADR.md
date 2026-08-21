# ADR: Code Graph / Repo Map

- **Status:** Implementado (Fases A-E, T1-T27) — nada commitado
- **Data:** 2026-08-18 a 2026-08-20
- **Escopo:** `apps/ai-api`, `apps/backend`, `apps/frontend`
- **Spec:** `.specs/features/code-graph-context/{spec,design,tasks}.md`

## Contexto

Ver `.specs/features/code-graph-context/spec.md` (Problema) e `design.md` (Prior art — GitNexus) pro histórico completo, incluindo o pivot de arquitetura decidido em sessão de design: indexação é ação separada e persistida por repo, análise de PR só consulta — nunca indexa dentro do run.

Este documento registra as decisões de implementação tomadas *durante* a execução de cada task de `tasks.md`, no nível de detalhe que a spec/design não cobrem (escolha exata de biblioteca, formato de query, valor de TTL, etc.). Cada seção corresponde a uma fase do `tasks.md`.

---

## Fase A — Núcleo de indexação (ai-api, grafo completo)

### Decisão A1 — Versões pinadas: `tree-sitter==0.25.2`, `tree-sitter-language-pack==1.14.3`

**O quê:** pin exato, não faixa aberta.

**Por quê:** a API de `Query`/captures mudou entre versões do binding Python (`Query.captures()` foi removido — captures agora só existe em `QueryCursor(query).captures(node)`, que retorna `dict[str, list[Node]]`, não mais lista de tuplas `(node, name)` como em versões antigas). Descoberto rodando o parser de verdade, não documentação — a doc oficial ainda mostra exemplos com API antiga em alguns lugares. Pin evita quebrar silenciosamente numa atualização futura de dependência.

### Decisão A2 — PageRank manual, sem `networkx` — **SUPERSEDIDA por A14**

**O quê:** grafo e PageRank (T12/Fase C) seriam implementação própria (power iteration puro Python), não `networkx.pagerank`.

**Por quê (à época):** o design (`design.md`, Fase C) deixou explícito "avaliar `networkx.pagerank` primeiro, só escrever manual se overhead não compensar". Testado: `networkx.pagerank` (3.4.2) importa `scipy` internamente e falha sem `numpy` instalado — ou seja, adicionar `networkx` de fato adiciona `numpy`+`scipy` como dependência transitiva, não só uma lib de grafo leve. Pro tamanho de grafo por repo aqui (centenas de nós, não milhões), isso parecia peso morto. `networkx` foi instalado, testado, e removido do `requirements.txt`.

**Por que superseded:** depois de Fase A pronta, revisão de arquitetura (conversa sobre onde persistir o grafo — ver A12) levou à adoção de Neo4j. Uma vez que o grafo já mora num banco de grafo nativo, PageRank via GDS (`CALL gds.pageRank.stream`) roda *dentro* do banco — não é mais "networkx vs manual em Python", é "Python vs banco", e banco ganha (zero dependência nova em Python, zero grafo inteiro carregado em memória pra rankear). Ver Decisão A14.

### Decisão A3 — Queries `.scm` por linguagem, não uma query genérica

**O quê:** 3 arquivos — `typescript.scm` (reusado pra `.ts`/`.tsx`), `javascript.scm` (`.js`/`.jsx`), `python.scm`.

**Por quê:** tentei reusar `typescript.scm` pra `javascript` e falhou — grammar JS não tem o node type `type_identifier` (usado pelo TS pra nome de classe), JS usa `identifier` puro ali. `tsx` sim aceita a query do `typescript.scm` sem alteração (grammar TSX estende TS). Isso é uma diferença real de grammar, não escolha de estilo — confirmado rodando `Query()` contra as duas gramáticas e vendo o erro exato (`Invalid node type: type_identifier`).

### Decisão A4 — Resolução de chamada via nome, não por tipo

**O quê:** `call_expression`/`call` captura tanto chamada direta (`foo()`) quanto chamada de método (`obj.foo()`), mas em ambos os casos só o **nome** do símbolo chamado é capturado (`call.name`), nunca o tipo de `obj`.

**Por quê:** resolver `obj.foo()` pro método exato exigiria inferência de tipo — explicitamente fora de escopo no spec ("resolução de tipo, dispatch dinâmico"). Resolução por nome (com fallback de unicidade já desenhado em `resolve_import`/CGC-05) é o compromisso consciente: funciona bem quando o nome é único no repo, degrada (sem aresta) quando é ambíguo — nunca adivinha errado silenciosamente.

### Decisão A5 — Método em Python é reclassificado depois do parse, não capturado direto

**O quê:** gramática Python não tem node type separado pra método (`method_definition` só existe em TS/JS) — `def` dentro de classe é o mesmo `function_definition` que top-level. `parse_file` captura tudo como `function` e reclassifica pra `method` checando se o nó pai-do-pai é `class_definition`.

**Por quê:** descoberto rodando teste real (`test_parse_file_python_extracts_function_and_method_and_call` falhou primeiro: `method1` saía como `kind="function"`). Corrigido com `_is_method_node()`, não alterando a query — a query não tem informação estrutural suficiente pra decidir isso sozinha (capture de nome não sabe se o `function_definition` pai está dentro de um `class_definition`).

### Decisão A6 — `resolve_import` python: nome importado é candidato a submódulo antes de ser candidato a símbolo

**O quê:** pra `from X import Y`, tenta primeiro resolver `X/Y.py` (Y é um arquivo dentro do pacote X — caso comum de import interno) e só depois `X` sozinho (Y é um símbolo dentro de `X/__init__.py`).

**Por quê:** dois testes falharam na primeira versão (`from . import qux` e `from pkg.sub import mod`) porque a implementação inicial descartava completamente a parte `import Y`, resolvendo só o módulo antes do `import` — que nem existe como caminho de arquivo isolado no caso relativo (`from . import qux` tem module=`"."`, sem `Y` não há nada pra resolver). Corrigido extraindo os nomes importados e tentando `base/nome` primeiro.

### Decisão A7 — Resolução de call ambígua: nunca "quase certo", só certo ou nada

**O quê:** `_resolve_callee` em `graph.py` só cria aresta `references` quando (a) exatamente 1 candidato do nome está entre os arquivos que o arquivo chamador importou, ou (b) nenhum candidato "preferido" existe mas o nome é globalmente único no repo inteiro. Qualquer outro caso (2+ candidatos, nenhum preferido por import) não gera aresta nenhuma.

**Por quê:** é literalmente o caso de borda do spec ("dois arquivos definem símbolo com mesmo nome... sistema NÃO DEVE cair pra resolução de símbolo único") — testado (`test_build_graph_ambiguous_callee_name_no_edge`). Preferir candidato cujo arquivo já está nos imports resolvidos do chamador (antes de cair pro fallback de unicidade global) reduz falso-positivo em repo grande onde o mesmo nome de função aparece em módulos não relacionados.

### Decisão A8 — Aresta `tests` é paralela, não substitui `references`/`imports`

**O quê:** `detect_test_edges` adiciona arestas `tests` novas em cima do grafo já construído, mantendo as arestas `references`/`imports` originais intactas — não muda o `kind` da aresta existente.

**Por quê:** o PageRank (Fase C) precisa da aresta `references` original pra ranking normal de callers; se a aresta virasse `tests` em vez de `references`, um caller que só existe em teste desapareceria do ranking de callers de produção. Duas arestas paralelas (mesmo from/to, kind diferente) resolvem os dois casos de uso sem um saber do outro.

### Decisão A9 — camelCase só nos modelos que cruzam a fronteira HTTP, snake_case no resto

**O quê:** `IndexResult` e `IndexStats`/`RelatedContext` usam campos camelCase (`indexId`, `indexedFiles`, `deadCodeCandidates`...). `Symbol`, `Edge`, `Graph`, `ParsedSymbols`, `RawCall`, `DeadCodeResult` continuam snake_case.

**Por quê:** achado rodando o teste HTTP de verdade — `test_index_build_http_returns_stats` falhou com `KeyError: 'indexId'` porque o modelo original tinha `index_id`. Investigando `apps/ai-api/app/application/dto/schemas.py` (convenção já estabelecida no projeto, não inventada agora), confirmei que todo modelo pydantic que vira JSON pra fronteira Nest/frontend usa camelCase direto no nome do campo (`fullContent`, `analysisId`, `apiKeys`) — sem `alias`, é o nome do campo mesmo. `Symbol`/`Edge`/`Graph` nunca cruzam essa fronteira (só persistem no Redis, lidos de volta só por Python), então ficam no padrão Python normal do resto do código (`change_analyzer/agent.py` é 100% snake_case). A linha de corte é literalmente "isso vira JSON pra fora do Python?" — não "é um modelo de dado importante?".

### Decisão A10 — Lock ocupado retorna 409, não espera nem enfileira

**O quê:** segunda chamada concorrente de `/index/build` pro mesmo `repo@sha` recebe HTTP 409 imediatamente, não fica bloqueada esperando a primeira terminar.

**Por quê:** testado com `monkeypatch` forçando `parse_file` a demorar 300ms e disparando 2 requisições em threads paralelas — confirma que a segunda nunca roda o pipeline (não reprocessa, cumprindo o requisito do spec), e falha rápido e explícito em vez de ficar pendurada. Cliente decide se tenta de novo; endpoint não implementa fila/retry — isso ficaria acoplado demais ao caso de uso de quem chama (usuário clicando 2x no botão "Indexar" é diferente de dois workers de CI disparando indexação automática).

### Decisão A11 — `tsconfig.json` é detectado por nome de arquivo entre os `files` enviados, não pedido à parte

**O quê:** `POST /index/build` procura um arquivo cujo path termina em `tsconfig.json` dentro da lista `files` já enviada, e usa o conteúdo dele pra `load_tsconfig_paths` — não é um campo separado no request nem uma segunda chamada ao GitHub.

**Por quê:** simplifica o contrato do endpoint (um request, uma lista de arquivos) — cabe ao backend (T9/T10, Fase B, ainda não implementada) garantir que `tsconfig.json` está entre os arquivos buscados da árvore do repo. Se não estiver presente, `tsconfig_paths` fica `{}` e a resolução de alias simplesmente não resolve nada (comportamento já coberto pelo caso de borda do spec: "repo sem tsconfig → resolução de alias é no-op silencioso").

### Decisão A12 — Grafo migra de Redis (blob) pra Neo4j (grafo nativo) — pivot pós-T7/T8

**O quê:** `cache.py` reescrito depois de já ter T7/T8 funcionando com Redis. Grafo agora persiste como nós/relacionamentos reais no Neo4j (`neo4j:5-community` + plugin `graph-data-science`, novo serviço em `docker-compose.yml`), tageados por propriedade `repoId`/`sha` em cada nó — não é multi-tenant por banco separado, é filtro por propriedade. Redis não desaparece: continua sendo o mecanismo de lock (`acquire_lock`/`release_lock`, `SETNX`+TTL) — só o dado do grafo em si sai de lá.

**Por quê:** pergunta direta levantou o ponto certo — "isso é uma transação, vamos salvar... backend não devia ficar com isso, já que tem Octokit?". Investigando: (1) o *fetch* do GitHub já era do backend desde o design original (T9/T10, Fase B) — isso não mudou; (2) a pergunta real era sobre *onde persiste*. Redis-como-blob (JSON serializado inteiro numa chave) não dava nenhuma vantagem de banco de verdade — toda consulta (ranking, dead-code) tinha que desserializar o blob inteiro e filtrar em Python, exatamente como Postgres/Mongo dariam. A alternativa que de fato muda o jogo é banco de grafo nativo: testado e confirmado que Neo4j Community + plugin GDS (grátis, sem paywall) roda PageRank *dentro* do banco (`CALL gds.pageRank.stream`), e relacionamento tem adjacência indexada nativa (traversal não degrada com `MATCH`/JOIN como banco relacional).

**Trade-off aceito:** infra nova (container a mais, driver `neo4j` novo) — pesado pra escopo de portfólio, mas justificado pelo que já foi achado no mesmo fio da conversa: repo de 1k+ arquivos é caso real que a v1 (Redis-blob) não escalava bem de qualquer jeito, e ranking em Python puro sobre grafo grande também não. Trocar cedo (com só T7/T8 escritos, antes de T12+ ranker existir) custou bem menos que trocar depois.

**Retrabalho concreto**: T7 (`cache.py`) e T8 (rota) reescritos; testes de `test_code_graph_cache.py`/`test_index_build_route.py` reescritos pra Neo4j; suíte inteira (132 testes) revalidada, zero regressão.

### Decisão A13 — Driver Neo4j e client Redis viram singleton em `app.state`, não recriados por request

**O quê:** primeira versão de `_get_cache()` em `api/routes/index.py` chamava `build_redis_client()` (depois `build_neo4j_driver()`) a cada request. Corrigido: `main.py`'s `lifespan` cria os dois uma vez (`app.state.neo4j_driver`, `app.state.index_redis`), rota lê de `request.app.state` — mesmo padrão que `agent.py` já usa pra `app.state.graph`.

**Por quê:** driver Neo4j e client Redis async gerenciam pool de conexão internamente — recriar por request vaza conexão, não é otimização prematura, é bug de recurso. Pego antes de virar problema porque bati de frente com a mesma armadilha que `test_agent_routes_http.py` já documenta pra `app.state.graph` (`TestClient(app)` bare não dispara lifespan) — tive que reescrever o teste de concorrência de T8 pra usar `with TestClient(app)` com um único client compartilhado entre as threads, não dois `TestClient` separados (que tentariam subir o lifespan duas vezes em paralelo).

### Decisão A14 — PageRank via Neo4j GDS, não mais implementação manual — supersede A2

**O quê:** `ranker.py` (T12, ainda não implementado) vai rodar `CALL gds.pageRank.stream` com `sourceNodes` (vetor de personalização = arquivos alterados pela PR) direto no Neo4j, em vez de carregar `Graph` inteiro em Python e rodar power iteration manual.

**Por quê:** confirmado antes de decidir (Knowledge Verification Chain — web search, não suposição): GDS roda como Community Edition por padrão, PageRank não é feature paga/Enterprise-gated. Testado localmente contra o Neo4j já subido: `gds.graph.project` + `gds.pageRank.stream` funcionam, resultado bate com a direção esperada (nó mais referenciado ranka mais alto). Motivo original de evitar `networkx` (A2 — puxa numpy/scipy escondido) continua correto, mas a alternativa não é mais "escrever na mão em Python" — é "deixar o banco fazer", que é estritamente melhor (sem dependência Python nova, sem carregar grafo inteiro em memória só pra rankear).

### Decisão A15 — Tipo de relacionamento Cypher via f-string, com whitelist de defesa

**O quê:** `CREATE (a)-[:{rel_type}]->(b)` usa f-string pra interpolar o tipo de relacionamento (`REFERENCES`/`IMPORTS`/`DEFINES`/`TESTS`), não parâmetro do driver.

**Por quê:** limitação real do Cypher, não descuido — o protocolo Bolt não permite parametrizar label/tipo de relacionamento, só valores de propriedade (testado: tentar passar tipo como parâmetro falha). Seguro aqui porque `edge.kind` vem de um `Literal` pydantic (só 4 valores possíveis, nunca texto arbitrário de usuário) — `RELATIONSHIP_TYPE_BY_KIND` em `cache.py` é uma segunda camada de whitelist (dict lookup, `KeyError` se algo fora do esperado chegasse), não confia só na validação do pydantic upstream.

### Decisão A16 — Nó `:RepoIndex` pra rastrear "último sha indexado", e limpeza por `repoId` (não por `repoId+sha`)

**O quê:** `build_and_store` agora faz duas coisas a mais: (1) `DETACH DELETE` por `repoId` sozinho (todo sha antigo daquele repo, não só o que tá sendo escrito); (2) `MERGE` num nó `:RepoIndex {repoId}` guardando `sha`/`indexedAt` mais recente. Novo método `get_latest_sha(repo_id) -> str | None`.

**Por quê:** dois problemas achados pensando no endpoint de status (T21, ainda não implementado) e a pergunta de reindex incremental. Primeiro — nó `:Symbol` só responde "esse repo@sha exato existe?"; não existe jeito barato de perguntar "qual foi o sha mais recente indexado desse repo?" sem escanear tudo (sha não é ordenável cronologicamente). Segundo, mais sério: a versão anterior de `build_and_store` só apagava nós do `repoId+sha` exato sendo escrito — reindexar um repo em commit novo (`sha2` depois de `sha1`) deixava os nós de `sha1` presos no banco pra sempre, nunca mais consultados por ninguém (nada aponta pra sha antigo depois que `RepoIndex.sha` avança). Isso é vazamento de storage sem limite — cada reindex acumula, nunca libera. Corrigido: um repo tem **um** grafo atual, não um por commit já indexado.

**Trade-off aceito:** perde a capacidade de consultar um grafo de um sha antigo depois que ele é substituído (não tem "grafo histórico"). Aceito — nenhuma story do spec pede isso, e reconstruir do zero se precisar é só rodar `/index/build` de novo contra aquele sha.

---

## Fase C — Consulta (ranking, orçamento, payload)

### Decisão C1 — PageRank só sobre `REFERENCES`; `IMPORTS` nunca entra na projeção

**O quê:** `ranker.py` projeta só a aresta `REFERENCES` pro GDS. `IMPORTS` não participa do PageRank de jeito nenhum — não é "peso menor", é ausência total da projeção.

**Por quê:** tentei primeiro misturar os dois tipos numa projeção Cypher só (`relationshipType: coalesce(type(r), '_NONE_')`, tipo dinâmico por linha), pra dar peso 2x em `REFERENCES` vs `IMPORTS`. Testado contra o Neo4j de verdade: 3 nós reais viraram 6 no grafo projetado, com linha de resultado duplicada por nó — o GDS agrupa a agregação Cypher por valor distinto de `relationshipType` quando ele varia linha a linha, registrando o nó fonte uma vez por "grupo de tipo" em vez de uma vez só. Descartado antes de virar bug em produção. `IMPORTS` conecta arquivo a arquivo, não símbolo a símbolo — caller de verdade só existe via `REFERENCES` nesse grafo, então excluir `IMPORTS` do ranking já satisfaz "caller pesa mais que import" do spec por construção, sem precisar da mistura de peso que quebrou.

### Decisão C2 — Projeção do GDS é invertida (callee→caller), não a direção de armazenamento

**O quê:** `gds.graph.project(nome, coalesce(t, s), s, {...})` — nota a ordem: alvo real (`t`) vira o nó-fonte da projeção, fonte real (`s`) vira o nó-alvo. Grafo persistido continua `caller→callee` como sempre; só a projeção efêmera pro GDS é espelhada.

**Por quê:** PageRank personalizado caminha na direção da aresta a partir do nó personalizado. Testado sem a inversão primeiro (cenário X chama Y chama Z, `Z` é o arquivo alterado, personalização em `Z`): sem inverter, o walk sai de `Z` seguindo arestas de saída — mas `Z` não TEM aresta de saída (`Z` é o `callee` final, ninguém aponta a partir dele) — logo `Y` e `X` (os callers reais) sempre pontuavam 0, o oposto do que o spec pede ("caller mais próximo ranka acima"). Invertendo a projeção, o walk personalizado em `Z` anda por `Z→Y→X` (na projeção), pontuando `Y` (caller direto) mais alto que `X` (caller transitivo) — confirmado com número real antes de escrever o teste automatizado, não só documentação do GDS.

### Decisão C3 — `id(n)` (deprecated) usado pra `sourceNodes`, não `elementId(n)`

**O quê:** `ranker.py` usa a função Cypher `id(n)` (inteira, legada) pra montar a lista de `sourceNodes` do `gds.pageRank.stream`, não a `elementId(n)` (string, recomendada desde Neo4j 5.x).

**Por quê:** testado — `gds.pageRank.stream`'s `sourceNodes` espera o id interno numérico que o próprio GDS usa no grafo projetado (`nodeId` no resultado do `YIELD`), que hoje é derivado do `id()` legado, não do `elementId()` novo. Neo4j avisa que `id()` some numa versão futura; quando isso quebrar, é questão de trocar a chamada — registrado aqui como débito conhecido, não descoberto por acidente depois.

### Decisão C4 — `Symbol` ganhou campo `body` (corpo completo), não só `signature`

**O quê:** `Symbol.body: str` novo, capturado em `indexer.py` (`source[def_node.start_byte:def_node.end_byte]`), persistido no Neo4j junto do resto. Default `""` pra não quebrar fixture de teste que só constrói `Symbol` com campos estruturais.

**Por quê:** `budget.py` (T13) precisa servir "corpo completo pros top-N vizinhos" — mas `Graph`/`Symbol` só guardavam `signature` (até o `{` da definição), nunca o corpo. Sem esse campo, `lookup()` reconstrói um grafo que não tem de onde tirar corpo nenhum pra devolver na review. Achado escrevendo `budget.py`, corrigido voltando pra `indexer.py`/`cache.py` antes de seguir.

### Decisão C5 — Alocação 60/30/10 é meta suave (greedy), não partição rígida — e ganhou teto de **quantidade**, não só de token

**O quê:** `budget.py::select` não separa o orçamento em 3 fatias fixas de antemão — dá pros arquivos alterados o que precisarem (nunca corta símbolo no meio, mesmo estourando a fatia "teórica" de 60%), aí distribui o resto por ranking. Além do corte por token, dois tetos de **contagem** novos: `MAX_FULL_BODY_NEIGHBORS=20`, `MAX_TAIL_ENTRIES=50`.

**Por quê:** partição rígida (60% sempre calculado sobre o budget total, não sobre o que sobrou) falha nos dois extremos — diff pequeno desperdiça fatia de vizinho que não usa; diff grande trunca sem necessidade quando ainda cabia tudo. Os tetos de contagem saíram de pergunta direta no meio da implementação: função central com 500 callers, mesmo cada assinatura sendo barata em token, sem teto de quantidade ainda vira 500 linhas na cauda — o orçamento por caractere sozinho não protege contra fan-out patológico, só contra símbolo grande. Os dois tetos juntos (token E contagem) fecham o buraco. Discussão sobre ir além disso (ex: relevância mais esperta que "N mais bem rankeados") fica pra depois da feature fechada, por decisão do usuário.

### Decisão C6 — Callees/tests são 1 salto direto, sem PageRank; `context.py` é a fachada única (T14)

**O quê:** `assemble_related_context` (novo `code_graph/context.py`) monta `RelatedContext` completo: chama `ranker.rank` pra callers, faz 2 buscas diretas no grafo (`_direct_targets`/`_direct_sources`, 1 salto, sem GDS) pra callees e testes, junta tudo numa lista só de candidatos pro `budget.select`, e categoriza o resultado final checando associação com `test_ids`/`callee_ids` (teste tem prioridade sobre caller/callee se um símbolo for as duas coisas).

**Por quê:** callee é "o que o símbolo alterado chama" — determinístico, sem ambiguidade de relevância, geralmente poucos (uma função chama um punhado de coisas, não centenas) — não precisa de PageRank pra isso, só teto defensivo (`MAX_CALLEES=20`) igual ao resto. Mesma lógica pra teste. Uma fachada só (não duas implementações) porque o P5 (`/index/context` standalone) e o P2 (`change_analyzer` in-process) precisam devolver exatamente o mesmo resultado pro mesmo input — CGC-16 exige isso explicitamente.

### Decisão C7 — Bug real pego pelo próprio teste de integração: candidato de teste filtrado cedo demais, nunca competia pelo orçamento

**O quê:** primeira versão de `context.py` removia `test_ids` da lista de candidatos ANTES de chamar `budget.select` (achando que evitava duplicar categoria) — corrigido pra deixar competir normalmente, categorização final decide o bucket.

**Por quê:** `test_assembles_callers_callees_and_tests_for_changed_file` falhou na primeira rodada — `src/z.test.ts` nunca aparecia em `context.tests`. Causa: removido da lista de candidatos cedo demais, nunca chegava no `budget.select`, logo nunca aparecia em `full_body_neighbors`/`signature_only_neighbors`, logo o loop de categorização (que já checava `test_ids` primeiro, corretamente) nunca tinha a chance de rodar em cima dele. Fix: parar de filtrar antes do orçamento — deixar competir, categorizar depois. Exatamente o tipo de bug que só aparece testando o fluxo inteiro de ponta a ponta, não peça isolada.

---

## Fase D — Reindex incremental + limite de arquivo

### Decisão D1 — `build_graph` ganha `reused_symbols`: sem isso, reindex incremental quebra resolução cross-arquivo silenciosamente

**O quê:** `graph.py::build_graph` ganhou parâmetro `reused_symbols: list[Symbol] | None` — símbolos de arquivos não-mudados, injetados em `symbol_by_name`/`known_paths` só pra efeito de **resolução de nome**, sem gerar aresta `defines` nova pra eles (essa aresta já existe do build anterior, mesclada de volta por fora).

**Por quê:** pensado ANTES de escrever qualquer coisa, não descoberto depurando — se `arquivo A` (não mudou) chama `função em B` (mudou), reparsear só `B` e rodar `build_graph` só com `B` faria `_resolve_callee` nunca achar `A` chamando `B` (porque `A` nunca foi re-parseado nessa rodada, `symbol_by_name` não teria os símbolos dele). Sem esse parâmetro, "reindex incremental" ia parecer funcionar (grafo constrói sem erro) mas silenciosamente perder aresta de caller toda vez que o caller não mudasse — exatamente o bug que essa feature inteira existe pra resolver, reintroduzido pela via incremental. Testado de propósito com esse cenário exato (`test_cross_file_resolution_survives_reindex_when_caller_unchanged_callee_changed`), passou de primeira.

### Decisão D2 — Aresta `tests` nunca é reaproveitada direto do grafo antigo — sempre recalculada

**O quê:** `_merge_reused_edges` pula explicitamente `kind == "tests"` ao trazer arestas do grafo antigo; `detect_test_edges` roda de novo em cima do grafo já mesclado (`defines`/`references`/`imports`, novos + reaproveitados).

**Por quê:** se arrastasse a aresta `tests` antiga E rodasse `detect_test_edges` de novo em cima do merge (que reprocessa toda aresta `references`/`imports`, incluindo as reaproveitadas), a mesma aresta `tests` apareceria duas vezes — bug óbvio o bastante pra evitar de propósito antes de escrever o teste, não precisou quebrar pra perceber.

### Decisão D3 — `content_hash` mora no nó `:Symbol` de tipo `file`, não em store separado

**O quê:** `Symbol.content_hash: str` (sha256 do conteúdo bruto) só é preenchido pro símbolo de arquivo (`kind="file"`), persistido junto no Neo4j — sem tabela/nó novo só pra rastrear hash.

**Por quê:** o nó de arquivo já existe (`_file_symbol`), já é reconstruído em todo `cache.lookup`; guardar o hash como propriedade dele evita criar mais um tipo de nó só pra isso. Comparação de hash pra decidir "reparsear ou reaproveitar" vira uma leitura que já vinha de qualquer jeito.

### Decisão D4 — Limite de arquivo corta por ordem determinística (path ordenado), não por ordem de chegada

**O quê:** `CODE_GRAPH_MAX_FILES` (default 1000, env var) — acima do limite, `sorted(files, key=path)[:limit]`, não os primeiros N na ordem que chegaram.

**Por quê:** ordem de chegada depende de como o backend montou a lista (Trees API não garante ordem estável entre chamadas) — cortar por isso tornaria "quais arquivos entraram" nao-determinístico entre indexações do mesmo repo gigante. Ordenar por path garante que rodar duas vezes corta o mesmo subconjunto, mesmo sem mudar nada no repo — combina com CGC-01 (contexto determinístico, sem LLM na seleção) aplicado também à indexação em si.

### Incidente — `models.py` sobrescrito por acidente, reconstruído na hora

Editando pra adicionar `VizNode`/`VizEdge`/`VizGraph`, usei `Write` em vez de `Edit` sem reler o arquivo primeiro — sobrescreveu o arquivo inteiro com um placeholder por engano. Reconstruído de memória (todo o histórico de campo/decisão já estava documentado nas decisões A9/C4/D3 acima) e revalidado rodando a suíte inteira antes de continuar — 169/169 batendo confirma que a reconstrução ficou byte-a-byte equivalente ao que existia. Sem isso a suíte teria pego na hora (qualquer campo esquecido quebraria um teste existente).

---

## Fase E — Visualização (P6)

### Decisão E1 — Agregação por diretório, não por nome de módulo declarado

**O quê:** `viz.py::serialize_overview` agrega por diretório do `path` (`src/foo/bar.ts` → grupo `src/foo`), não por algum conceito de "módulo" declarado no código (namespace, package name, etc).

**Por quê:** diretório é a única unidade estrutural que toda linguagem suportada (TS/JS/Python) tem de graça, sem parse adicional — já está no `Symbol.path` desde a Fase A, zero custo extra. Um conceito de "módulo declarado" (namespace TS, pacote Python) exigiria extração nova por linguagem, sem benefício claro sobre a pasta pra uma visão "zoomed out" de repo.

### Decisão E2 — Aresta `defines` nunca aparece na visualização

**O quê:** `VISUALIZABLE_EDGE_KINDS = ("references", "imports", "tests")` — `defines` (arquivo → símbolo que ele contém) é excluída tanto de `serialize_overview` quanto de `expand_neighborhood`.

**Por quê:** `defines` é bookkeeping estrutural (todo símbolo já carrega `path`, a relação "está em qual arquivo" já é implícita), não uma relação que valha desenhar como aresta — incluir duplicaria visualmente o que o agrupamento por arquivo/diretório já mostra, sem sinal novo.

### Decisão E3 — Aresta na visão agregada só sobrevive se cruza diretório

**O quê:** ao agregar por diretório, aresta cujo `from`/`to` caem no mesmo diretório é descartada — só aresta entre diretórios diferentes vira aresta entre nós de módulo.

**Por quê:** aresta dentro do mesmo diretório, agregada, viraria auto-loop no nó de módulo (`module::src/foo → module::src/foo`) — sem informação nenhuma numa visão "zoomed out" (é óbvio que arquivo dentro da mesma pasta se referenciam). Testado explicitamente (`test_serialize_overview_aggregation_drops_same_directory_edges`).

### Decisão E4 — Achado navegando a app de verdade (Chrome): clicar em nó de classe expandia vazio

**O quê:** `expand_neighborhood` ganhou `NEIGHBORHOOD_EDGE_KINDS` separado de `OVERVIEW_EDGE_KINDS` — inclui `defines` (excluída da visão geral, Decisão E2). Frontend (`useRepoGraph.ts`) passou a expandir com `depth=2`, não `depth=1`.

**Por quê:** testado a feature inteira rodando de verdade no Chrome (não só suíte automatizada) — clicar no nó `UserService` (classe) expandia pra um nó sozinho, sem vizinho nenhum. Causa: classe e método são **irmãos** sob o mesmo arquivo no grafo (`file --defines--> class`, `file --defines--> method`, lado a lado), não pai-filho direto (`class --defines--> method` não existe) — porque `graph.py` sempre emitiu `defines` do arquivo pra cada símbolo, nunca aninhado por classe. Com `defines` incluído mas `depth=1`, clicar na classe só alcança o arquivo (1 salto: classe↔arquivo); os métodos ficam a 2 saltos (classe↔arquivo↔método). Corrigido subindo o depth padrão do frontend pra 2, não reestruturando o modelo de aresta (mudança maior, sem necessidade clara agora — registrado como possível melhoria futura: rastrear `class_id` por método pra ter `defines` direto classe→método). Dois testes de regressão cobrem os dois níveis (`depth=1` só alcança arquivo; `depth=2` alcança os métodos).

Achado só possível testando a UI de verdade — nenhum teste unitário anterior clicou num nó de **classe** (todos usavam `function`), então a lacuna nunca apareceu na suíte automatizada.

### Decisão E5 — Achado pelo usuário testando repo real: clicar em nó de módulo (visão agregada) expandia vazio

**O quê:** `expand_neighborhood` ganhou caso especial no topo — `focus_id` começando com `MODULE_ID_PREFIX` ("module::") desvia pra `_expand_module(graph, directory)`, função nova que devolve todo símbolo cujo `_directory_of(path)` bate com o diretório clicado, mais as arestas entre eles (sem sair do diretório — ver trade-off abaixo).

**Por quê:** usuário indexou o repo de verdade (`pedrocastanha/cast-review`, ~50+ diretórios, grande o bastante pra disparar agregação da Decisão E1) e reportou "se eu clico eu não consigo ver mais nada" — bug que nenhum teste anterior pegou porque toda fixture de teste até agora era pequena o bastante pra nunca cruzar `max_nodes` e cair na visão agregada; todo teste de `expand_neighborhood` clicava num símbolo real. `focus_id` de nó de módulo é sintético (`f"module::{directory}"`, Decisão E1/E3) — nunca existiu como `Symbol.id` real, então o BFS por aresta (`if focus_id not in graph.nodes: return empty`) sempre batia no caso vazio, silencioso, sem erro. Dois testes de regressão novos (`test_code_graph_viz_module_drilldown.py`): drill-down popula símbolos do diretório certo e exclui de outro; diretório desconhecido devolve vazio sem lançar exceção.

**Trade-off aceito:** `_expand_module` não mostra aresta que sai do diretório (símbolo aqui chamando outro em módulo vizinho ainda colapsado) — aceitável pro primeiro nível de drill-down; usuário clica no módulo vizinho separadamente em vez de a view tentar mostrar tudo conectado de uma vez.

### Decisão E6 — Layout da visão agregada: grade quadrada + espaçamento maior + labels curtos + aresta sem texto, coloridas por tipo

**O quê:** `RepoGraphPage.tsx` trocou grade fixa de 6 colunas por `columns = ceil(sqrt(nodes.length))`; `COL_SPACING`/`ROW_SPACING` maiores (220→260, 120→150); labels de nó tipo `module` truncados pros últimos 2 segmentos do path (`shortLabel`); aresta perdeu texto de label próprio, ganhou cor por `kind` (`EDGE_COLORS`) em vez disso.

**Por quê:** mesmo relato do usuário testando `cast-review` de verdade — "tá uma zona, tá bem feio, bagunçado". Causa raiz é escala: grade de 6 colunas fixa pra ~50 módulos vira grade larga e rasa (muitas linhas curtas), pior pra cruzamento de aresta que uma grade próxima de quadrada; texto de path completo (`apps/ai-api/app/graph/agents/x`) não cabe na largura do nó; label de texto por aresta numa view com dezenas de aresta vira caixa competindo por espaço, piorando exatamente a poluição visual reportada. Nenhuma dessas quatro causas aparece testando com o grafo pequeno sintético usado até então — só ficou visível testando contra volume real. Verificado ao vivo no Chrome contra `pedrocastanha/cast-review` reindexado: grade mais legível, cruzamento de aresta reduzido, cor por tipo ainda distingue `references`/`imports`/`tests`/`defines` sem texto.

Ambas (E5, E6) achadas pelo usuário testando a feature já "fechada" (Fases A-E, T1-T27) contra um repo real pela primeira vez — nenhum teste automatizado ou verificação anterior no Chrome (Decisão E4 usou grafo pequeno) cobria escala real de repo grande.

### Decisão E7 — Agregação vira árvore de diretório real (multi-nível), não achatada em 1 nível

**O quê:** `serialize_overview` agrega só no **depth 1** (`apps/ai-api`, não `apps/ai-api/app/graph/agents`) em vez do diretório-folha completo. `expand_neighborhood`/`_expand_module` (`viz.py`) reescritos: clicar num nó de módulo desce **um segmento de diretório por vez** — se `directory` ainda tem subdiretório, mostra os filhos diretos (mais um nó "arquivos" self-bucket, `SELF_SUFFIX = "::__files__"`, se o diretório também tiver arquivo próprio ali, não só subpasta); só quando `directory` é folha (sem subdiretório) mostra os símbolos de verdade (`_expand_leaf_directory`, mesma lógica que já existia, renomeada).

**Por quê:** pedido direto do usuário depois de testar E5/E6 ao vivo — "os nós poderiam ter uma hierarquia... apps/ai-api -> app -> modules -> files -> methods". A agregação anterior (leaf-directory direto, Decisão E1) já produzia uma visão mais legível que a bruta, mas ainda achatava ~50 diretórios-folha lado a lado na visão inicial — sem noção de árvore, só uma grade de caixas. Reescrito pra usar a árvore de diretório real: `_prefix_at_depth` corta o path do símbolo no N-ésimo segmento; `serialize_overview` sempre usa depth=1; drill-down recalcula `depth+1` a cada clique, comparando contra os diretórios-folha reais (`_directory_of` de cada símbolo) pra decidir se ainda há filho ou se já é folha. Verificado ao vivo contra `pedrocastanha/cast-review` (repo real, ~757 símbolos sob `apps`): `apps (757)` → `apps/ai-api (292)` / `apps/backend (334)` / `apps/frontend (131)` → `.../ai-api/app (147)` / `.../ai-api/tests (145)` → `.../app/graph (97)` (+ irmãos `api`, `application`, `config`, `domain`, `infrastructure`) → `.../graph/agents (29)` (+ irmãos `nodes`, `utils`) → `.../agents/architecture_reviewer (5)` (+ self-bucket `.../graph/agents`, e irmãos `implementation_spec`, `prd`, `test_reviewer`) → folha: `__init__.py`, `agent.py`, `run_architecture_reviewer`, `node`, `_user_prompt` — seis níveis de árvore real, cada clique descendo exatamente um segmento.

**Trade-off aceito:** sem breadcrumb/histórico multi-nível ainda — `resetToOverview` (botão "Voltar pra visão geral") sempre pula direto pro topo, não um nível por vez. Registrado como próxima melhoria natural de UX, não implementado agora (fora do que foi pedido).

Três testes de regressão novos/reescritos em `test_code_graph_viz_module_drilldown.py` e `test_code_graph_viz.py` cobrem: drill multi-hop até folha, diretório com arquivo próprio + subpasta ao mesmo tempo (self-bucket), e overview forçando agregação no depth 1. Suíte ai-api completa (146+ testes não-infra) verde; falhas restantes são só Neo4j/Redis fora do ar localmente (infra, não código) — confirmadas rodando os mesmos testes com Redis ligado.

### Decisão E8 — Overview vira árvore inteira numa resposta só; clique deixa de navegar, passa a expandir/recolher in-place; hover apaga o que não está conectado

**O quê:** três mudanças pedidas juntas pelo usuário depois de testar E7 ao vivo:

1. `_serialize_directory_tree` (`viz.py`, substitui o corpo grande de `serialize_overview`) devolve **todo** diretório da árvore (raiz até folha) numa resposta só — não mais só o nível 1. Símbolo real de uma pasta-folha continua sob demanda (`expand_neighborhood`), evitando o motivo original da agregação existir (repo com milhares de símbolo travando o layout se carregasse tudo de uma vez — confirmado com o usuário via pergunta direta antes de implementar, ver AskUserQuestion na sessão: "árvore de pastas aberta, símbolo sob clique" foi a opção escolhida, não "tudo, símbolo incluso").
2. `RepoGraphPage.tsx` reescrito: sem mais `focus`/navegação de página por clique — nó de módulo agora aninha visualmente dentro do nó-pai (React Flow `parentId`/`extent:'parent'`, mecanismo de "group node"), layout calculado em duas passadas (`measure` bottom-up pra tamanho, `place` top-down pra posição), reusando a heurística de grade quase-quadrada já estabelecida (Decisão E6). Clicar numa pasta-folha ou num "bucket" de arquivo-próprio carrega os símbolos dela e os renderiza aninhados no lugar (sem trocar de tela); clicar de novo recolhe (estado local, não perde o fetch — símbolo já buscado fica em cache no hook, só alterna visibilidade).
3. `applyHoverEmphasis`: ao passar o mouse num nó, todo nó/aresta não ligado a ele (1 salto, olhando só as arestas atualmente renderizadas) cai pra opacidade 0.15/0.08. Como a árvore de diretório não carrega aresta nenhuma entre módulos (Decisão E8.1 abaixo), isso só faz efeito de verdade depois que o usuário expande pelo menos uma pasta-folha em símbolo real — comportamento esperado, não bug.

**Por quê:** pedido direto do usuário — "na página inicial, já mostrar TUDO, organizado de forma hierárquica... E ter um 'aviso' explicando o que seria cada um dos arquivos... ao passar o mouse em cima de um nó, ele vai meio 'diminuir a opacidade' de todos os nós que não estejam ligados". O modelo de "clica, navega pra outro nível, perde o resto" (E7) resolvia a hierarquia mas ainda escondia tudo que não fosse o nível atual — pedido agora é literalmente o oposto: tudo visível ao mesmo tempo, aninhado. Confirmado com o usuário que "símbolo" (função/método) não precisa vir de cara — só a árvore de pasta, repo real (`cast-review`, 757 símbolos) tem ~79 nós de diretório no total, perfeitamente renderizável de uma vez; carregar todo símbolo eager é que travaria.

**Sub-decisão E8.1 — árvore não carrega aresta nenhuma entre módulos:** cross-directory edge (a mesma referência lógica) cruzaria múltiplos níveis de aninhamento simultaneamente se desenhada em toda profundidade ao mesmo tempo — mais poluição visual que sinal. Legenda (novo componente `Legend`, `<Panel position="top-right">` do `@xyflow/react`) já documenta isso implicitamente ao listar as 4 cores de aresta só como referência — elas só aparecem de fato depois que o usuário expande alguma pasta em símbolo real.

**Bug pego durante a verificação ao vivo, não na suíte automatizada:** primeira tentativa mostrou só 1 nó (`apps (757)`) em vez da árvore inteira — não era bug de lógica, era o processo `uvicorn` local ainda rodando o código de ANTES da reescrita de `serialize_overview` (reiniciado uma vez pra E7, mas as mudanças de E8 vieram depois, sem reiniciar de novo). `curl` direto no `ai-api` confirmou (1 nó só, sem reiniciar; 79 nós, depois de reiniciar) — servidor de dev sem `--reload` não é um bug de código, é um lembrete de processo: qualquer teste ao vivo depois de editar `viz.py` precisa reiniciar o `uvicorn` primeiro.

Verificado ao vivo no Chrome contra `pedrocastanha/cast-review` real: árvore inteira aninhada renderiza de cara (apps/ai-api, apps/backend, apps/frontend, cada um com suas subpastas visíveis simultaneamente); clique numa folha (`.../graph/nodes`) carrega e aninha os símbolos reais (arquivo cinza + função verde) sem trocar de página; hover numa função apaga tudo, exceto ela e o arquivo que a `defines`, mantendo os dois em opacidade plena. Suíte ai-api (188 testes) e `tsc`/`oxlint` do frontend seguem limpos.

### Decisão E9 — `nodesDraggable={false}` + `minZoom` mais baixo: usuário não conseguia arrastar nem ver a árvore inteira

**O quê:** `<ReactFlow>` (`RepoGraphPage.tsx`) ganhou `nodesDraggable={false}` e `minZoom={0.05}` (era o default do xyflow, ~0.5).

**Por quê:** usuário testou E8 contra o mesmo repo real e reportou "não ficou legal... não dá pra ver tudo, o gráfico não dá pra arrastar pro lado". Duas causas distintas, achadas investigando ao vivo (não hipótese):

1. **Não arrastava**: todo nó de módulo (contêiner ou folha) tinha `draggable` no padrão do xyflow (`true`) — como as caixas de diretório cobrem a maior parte do canvas visível (é uma árvore aninhada, não pontos esparsos), qualquer gesto de arrastar começando em cima de uma caixa tentava mover aquele nó sozinho em vez de fazer pan do canvas. Com uma árvore inteira sempre visível (Decisão E8), praticamente todo lugar clicável na tela É uma caixa — na prática, arrastar nunca funcionava. Nenhum nó nesta view precisa ser reposicionado manualmente (layout é sempre recalculado, Decisão E7/E8) — desligar drag de nó globalmente resolve sem precisar de exceção por tipo de nó.
2. **Não dava pra ver tudo**: `fitView` já tentava enquadrar a árvore inteira, mas o `minZoom` padrão do xyflow (~0.5) impedia zoom out suficiente pra um repo do tamanho do `cast-review` (79 nós de diretório) caber no viewport — o zoom parava antes de conseguir encaixar tudo, cortando pedaço da árvore pra fora da tela. `minZoom={0.05}` deixa o `fitView` (e o controle de zoom manual) ir bem mais longe.

Verificado ao vivo: `left_click_drag` a partir de cima de uma caixa de módulo agora move o canvas (não a caixa); recarregando a página, `fitView` com o `minZoom` novo encaixa a árvore inteira (`apps/ai-api`, `apps/backend`, `apps/frontend` simultâneos) sem precisar de pan nenhum pra ver tudo de cara.

**Trade-off aceito:** tentativa inicial também aumentou a altura do canvas (`75vh` → `85vh`) pra dar mais espaço — revertida no mesmo round: empurrava os controles de zoom (`<Controls>`, canto inferior esquerdo) pra fora da viewport visível sem o usuário precisar rolar a página, piorando a usabilidade em vez de ajudar. `75vh` já é suficiente uma vez que `fitView`+`minZoom` resolvem o problema real.

---

## Ideias futuras — registradas, não implementadas nesta sessão

Discutidas com o usuário durante a implementação, adiadas de propósito pra depois da feature fechar:

1. **Relevância além de "top-N rankeado por PageRank"** — pra função com fan-out muito alto (centenas de callers), hoje o corte é por ranking + teto de contagem (`MAX_FULL_BODY_NEIGHBORS`/`MAX_TAIL_ENTRIES`, Decisão C5). Discussão futura: alguma forma mais esperta de decidir relevância do que "os N com maior score" — ex. levar em conta o que exatamente mudou na PR (linha específica), não só "existe uma call edge".
2. **Descrição semântica por símbolo** — hoje `Symbol` guarda código estrutural (nome, assinatura, corpo — Decisão C4), zero descrição do tipo "o que esse símbolo faz". Ideia do usuário: gerar isso via LLM na indexação. Trade-off real levantado na hora: indexação hoje é CPU-bound e grátis (sem chamada de LLM, sem custo de token) — isso mudaria pra ter custo recorrente por arquivo indexado/reindexado, mesmo não violando o princípio de "seleção de contexto determinística" (a chamada LLM seria na indexação, não na seleção).
3. **Visão macro do sistema, não só por diretório** — `serialize_overview` (Decisão E1) só agrega por pasta. Ideia: noção de "camada" (controller/service/repository) ou "domínio", não só estrutura de arquivo — precisaria de heurística nova (por convenção de nome? por decorator? por config explícita do usuário?) pra classificar cada símbolo numa camada.

---

## Fechamento — verificação final

### Decisão F1 — Teste de integração da fila: `Job.remove()` falha com `Test.createTestingModule`, `Queue.remove(jobId)` não

**O quê:** `index-queue.integration.spec.ts` trocou `job.remove()` por `queue.remove(jobId)` na limpeza entre casos.

**Por quê:** rodando a verificação final, `job.remove()` começou a falhar com `"locked by another worker"` — investigado a fundo: não é servidor real competindo (parei todo processo node, `ps aux` limpo, `redis-cli KEYS bull:code-index:*` só tinha `meta`/`stalled-check`, nada de job/lock sobrando). Reproduzido isolado com BullMQ puro (fora do Nest) — funciona sem erro nenhum. O erro só acontece quando o `Queue` vem de `Test.createTestingModule` do NestJS. Não persegui a causa raiz exata (fica como nota, não como bug resolvido) — trocar pro método de nível de fila (`queue.remove(jobId)`, testado isolado e confirma funcionar nos dois contextos) resolve sem precisar entender o porquê exato do `Job.remove()` se comportar diferente sob o testing module. Estabilidade confirmada rodando 3x seguidas.

### Feature fechada — Fases A-E, T1-T27

ai-api: 184 testes. backend: 85 unit + 2 integration. frontend: tsc/lint limpos. Verificação visual real no Chrome (não só suíte automatizada) — achou e corrigiu 1 bug real (Decisão E4, expansão de classe vazia) que nenhum teste unitário pegou porque nenhum tinha focado num nó de tipo `class` antes. Nada commitado, por instrução do usuário durante toda a sessão.

### Decisão C8 — `AgentRunRequest` ganhou `repoId`/`sha` opcionais — buraco real achado escrevendo T16

**O quê:** `repoId: str | None = None`, `sha: str | None = None` novos em `AgentRunRequest` (Python), propagados pro `GraphState` (`repo_id`/`sha`) em `pipeline.py::run_pipeline`.

**Por quê:** pra `change_analyzer` consultar o índice, precisa saber `repoId`+`sha` — e esses campos **não existiam em lugar nenhum** do contrato `/agent/run` (confirmado lendo `schemas.py` antes de escrever o node — nem `AgentRunRequest` nem `ChangedFileContext` carregavam isso). Sem essa mudança, T16 inteiro seria código morto — `change_analyzer` nunca teria como saber qual repo@sha consultar. Opcional (não obrigatório) de propósito: backend ainda não manda esses campos (isso é trabalho de T18/backend, fora desta sessão) — enquanto isso, ausência vira `relatedContext: null`, mesmo caminho de "repo nunca indexado" (CGC-12), não erro.

### Decisão C9 — `change_analyzer` usa singleton lazy por módulo, não `app.state`

**O quê:** `_get_index_cache()` em `change_analyzer/agent.py` guarda driver/client em variável de módulo (`global _driver, _cache`), construídos na primeira chamada — não usa o padrão `request.app.state.neo4j_driver` que `routes/index.py` usa (Decisão A13).

**Por quê:** node do LangGraph roda dentro de `graph.astream`, sem acesso ao objeto `Request` do FastAPI que os outros singletons dependem pra pendurar em `app.state`. Mesma motivação de A13 (conexão pooled, não recriar por chamada), mecanismo diferente porque não tem `Request` disponível nesse ponto de execução.

### Decisão C10 — `change_analyzer` nunca deixa exceção de grafo derrubar o run — `try/except` largo, de propósito

**O quê:** `_related_context()` engloba a chamada pra `assemble_related_context` inteira num `except Exception: return None`.

**Por quê:** mesmo espírito de CGC-04 (Fase A) — Neo4j fora do ar, Redis fora do ar, bug novo em `context.py`, qualquer coisa: o run de análise não pode falhar por causa do enriquecimento de grafo, que é sinal a mais, não requisito pra review acontecer. Testado com `monkeypatch` forçando exceção, confirma `relatedContext: None`, run completa normal.

### Decisão C11 — Bloco de contexto relacionado compete pelo mesmo orçamento de caractere do resto do prompt, não é extra

**O quê:** `files.py::_related_context_block` retorna string já cortada em `[:budget]`, onde `budget` é o que sobrou depois de montar o bloco de arquivos alterados — não é uma seção com orçamento próprio somado por cima.

**Por quê:** CGC-11 pede "orçamento gerenciado", não "corte cego" — mas o corte real por símbolo já aconteceu antes, em `budget.py`/`context.py` (Fase C, orçamento de token). O corte de caractere aqui em `files.py` é só a segunda camada (`MAX_PROMPT_TOTAL_CHARS`, que já existia antes desta feature) — sem esse corte final, o texto renderizado do `relatedContext` poderia, em teoria, estourar o teto de char do prompt inteiro mesmo já tendo respeitado o teto de token da seleção.

### Decisão C12 — `test_reviewer` continua usando `analysis["hasTests"]` booleano — não trocado pela aresta `tests` do grafo

**O quê:** T17 conectou `relatedContext` (incluindo a lista `tests`) no prompt de `test_reviewer` — mas a lógica de decisão "essa PR tem teste?" (`analyze_changes`, `hasTests`) continua sendo o booleano antigo, não passou a consultar `relatedContext.tests`.

**Por quê:** o design.md original já sinalizava isso como melhoria válida ("é muito melhor que o `analysis['hasTests']` booleano de hoje"), mas é mudança de lógica de negócio do `test_reviewer` (o que conta como "coberto por teste"), não plumbing de prompt — fora do escopo literal de T17 (`tasks.md`: "files_block consome repoMap+callers, atualiza os 4 call sites"). Registrado aqui como próximo passo natural, não esquecido por acidente.

### Decisão C13 — `AgentRunRequest` (TS) ganhou `repoId`/`sha` de verdade — T18 original virou obsoleto antes de ser escrito

**O quê:** T18 originalmente previa "backend ganha tipo `ChangedFileContext.relatedContext`". Não implementado assim — descoberto que `relatedContext` nunca volta pro TS (é montado e consumido inteiro dentro do `ai-api`, só usado pra montar prompt). O que fazia falta de verdade: backend nunca mandava `repoId`/`sha` na **request** de `/agent/run` — sem isso, T16 inteiro (já testado, já funcionando) não tinha como disparar em produção, porque `state["repo_id"]`/`state["sha"]` nunca eram populados.

**Por quê:** `context-builder.helper.ts::buildAgentRunRequest` ganhou `repoId: `${resolvedOwner}/${repo}`` (mesmo formato usado em `enqueueIndexJob`, backend Fase B) e `sha: pull.headSha` (já disponível em `PullSummary`, nunca usado antes pra isso). `resolvedOwner` resolvido via `loginFor(currentUser)` quando não há override — mesmo padrão de todo o resto do arquivo. Achado revisando o que T18 realmente precisava fazer antes de implementar o que o `tasks.md` descrevia ao pé da letra — spec/design escritos antes de T16 existir não previam esse detalhe.

---

## Fase B — Disparo de indexação (backend)

### Decisão B1 — `tree-fetcher.helper.ts` tipa `Octokit` com `import type`, nunca importa o módulo de verdade

**O quê:** `import type { Octokit } from '@octokit/rest'` — o helper recebe uma instância já construída, nunca constrói uma. Teste passa objeto plano (`{git: {getTree, getBlob}}` mockado) tipado `as unknown as Octokit`, sem nunca carregar o módulo real.

**Por quê:** achado lendo `analyses.service.spec.ts` antes de escrever teste — comentário lá documenta que `@octokit/rest` é ESM-only e o `transformIgnorePatterns` do Jest (`"node_modules/(?!(@octokit)/)"`) cobre `@octokit/rest` em si mas não as dependências transitivas dele fora do escopo `@octokit/*`, e por isso qualquer teste que importe `RepositoriesService` de verdade precisa de `jest.mock()` explícito. `import type` evita o problema de raiz — erased em build, nunca vira `require()` — então nem precisei do `jest.mock()`. Mais simples que replicar o workaround existente.

### Decisão B2 — Concorrência limitada pra `getBlob`, sem nova dependência

**O quê:** `mapWithConcurrency` (helper inline, ~15 linhas) limita a 10 chamadas paralelas de `git.getBlob`, em vez de `Promise.all` disparando tudo de uma vez.

**Por quê:** repo de centenas/milhares de arquivos (o cenário que motivou o pivot pra BullMQ) disparando centenas de requests HTTP simultâneas pro GitHub arrisca rate limit. Não existe `p-limit` ou equivalente nas deps do backend hoje — escrever os ~15 linhas inline evita dependência nova só pra isso.

### Decisão B3 — `ioredis` precisou ser instalado explicitamente, não vem de graça com `bullmq`

**O quê:** `npm install @nestjs/bullmq bullmq` sozinho não é suficiente — `ioredis` (o client Redis que o BullMQ usa por baixo) é dependência opcional, não instalada automaticamente.

**Por quê:** descoberto rodando o teste de integração de verdade contra o Redis do `docker-compose.yml` — `BullModule.forRoot` falhava com `"BullMQ could not load the optional 'ioredis' package"` só nesse teste (specs unitárias, que mockam tudo, nunca chegam a instanciar a conexão de verdade, então passavam mesmo com a dependência faltando). Sem esse teste de integração, isso só apareceria em produção/dev real ao subir a app — `npm install ioredis` resolveu.

### Decisão B4 — `*.integration.spec.ts` excluído do `npm run test` default, script `test:integration` separado

**O quê:** jest config (`package.json`) ganhou `testPathIgnorePatterns` excluindo `\.integration\.spec\.ts$` do roda-padrão; script novo `test:integration` inverte isso (só roda esse padrão), precisa de Redis real.

**Por quê:** esse backend não tinha precedente de teste "precisa de infra" fora do `test:e2e` (config separado, pasta `test/`, sempre precisou de Postgres). Meu primeiro teste de fila (`index-queue.integration.spec.ts`) ficou em `src/`, mesmo padrão `*.spec.ts` de tudo mais — rodando `npm run test` (o gate "rápido, sem serviço externo" documentado em TESTING.md) ia tentar conectar em Redis e falhar sempre que Redis não estivesse de pé, quebrando a promessa de "quick" sem eu perceber até rodar a suíte inteira sem Redis local. Corrigido isolando pelo nome do arquivo, sem precisar de pasta separada nem segundo `jest.config`.

### Decisão B5 — Endpoint `GET /index/status` no ai-api criado fora de ordem, antes do T21/T22 formais do `tasks.md`

**O quê:** pra `RepositoriesService.getRepositoryIndexStatus` (T21) fazer sentido, o `ai-api` precisava expor `get_latest_sha` via HTTP — que só existia como método Python interno (`IndexCache`, Decisão A16). Adicionado `GET /index/status?repoId=` (`IndexStatusResponse{indexed, sha}`) antes de tocar em T21/T22 de verdade, porque T21 não tem como ser implementado sem essa peça existir primeiro — o `tasks.md` não previa esse degrau entre T10 e T21 explicitamente.

**Por quê:** descoberto na hora de escrever T21 — "status" precisa perguntar pro `ai-api` "esse repo já foi indexado, com que sha", e não existia jeito de perguntar isso de fora do processo Python. Endpoint novo, 2 testes HTTP, sem mudar nada do que já tava construído.

### Decisão B6 — Status "queued"/"indexing" nunca consulta o `ai-api`; job ativo é sempre a fonte de verdade mais recente

**O quê:** `getRepositoryIndexStatus` checa primeiro se existe job BullMQ ativo pro `jobId` determinístico do HEAD atual (`queue.getJob`); só cai pro `ai-api` (`get_latest_sha`) quando não há job em voo.

**Por quê:** como `removeOnComplete`/`removeOnFail` tiram o job da fila assim que termina, `getJob` só retorna algo enquanto o trabalho ainda não terminou — então "job encontrado" e "olhar estado final no ai-api" são mutuamente exclusivos por construção, não por uma checagem extra de "já terminou?". Simplifica a lógica: 2 branches, não 3.

### Decisão B7 — Botão de indexar fica dentro de um `<Link>` inteiro clicável — `preventDefault`+`stopPropagation` no clique

**O quê:** `RepositoryCard.tsx` inteiro já é um `<Link>` pra página de PRs do repo (decisão de UI anterior a esta feature). O botão "Indexar"/"Atualizar" fica dentro dele — `onClick` do botão chama `e.preventDefault()` e `e.stopPropagation()` antes de disparar `trigger()`, senão clicar no botão também navegaria pra página de PRs.

**Por quê:** só notado escrevendo o componente, lendo `RepositoryCard.tsx` original — não é um padrão já resolvido em outro lugar do código pra copiar, primeira vez que esse card ganha um elemento interativo próprio.

### Decisão B8 — Polling de status só liga enquanto `queued`/`indexing`, e reage a mudança de estado, não só à montagem

**O quê:** `useRepositoryIndexStatus` tem 2 `useEffect` separados: um busca status uma vez ao montar; outro agenda o próximo poll (`setTimeout`, não `setInterval`) só quando `status?.status` é `queued`/`indexing`, e depende de `status` — então reagenda sozinho toda vez que `trigger()` muda o status pra `queued`, não só na montagem do componente.

**Por quê:** primeira versão tentava controlar o loop de polling inteiramente dentro do `useEffect` de montagem (recursão via closure) — funcionava só se o repo já estivesse `queued` no primeiro carregamento da página, porque a recursão decidia "continuar ou não" uma vez só, na montagem, e nunca mais reavaliava depois que `trigger()` mudava o estado no meio do caminho (o caso normal: usuário clica DEPOIS que o card já carregou como `not_indexed`). Reescrito pra depender de `status` como dependência do efeito — bem mais simples e correto. Achado revisando a lógica antes de rodar, pensando no fluxo real (clique do usuário acontece depois da montagem, quase sempre), não em produção.

