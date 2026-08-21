# Especificação — Code Graph / Repo Map

**Origem:** `docs/proposals/02-code-graph-context.md` (escopo completo, revisado após descoberta de arquitetura em sessão de design)

## Problema

`import-resolver.helper.ts` acha arquivo relacionado por regex, só import relativo, só JS/TS, cap de 3 arquivos / 4000 chars via `slice()` puro (`context-builder.helper.ts:11-12,115`). Callers do símbolo alterado nunca entram no contexto — grafo só olha pra frente (imports), nunca pra trás (references). Causa raiz de falso positivo ("validação não existe" — existe, no caller) e falso negativo ("assinatura mudou, nada quebrou" — 4 callers quebraram).

**Correção de rota (importante):** a primeira versão deste spec tentava resolver isso indexando só os arquivos da PR + "vizinhos de 1-2 saltos" dentro do próprio run de análise. Isso não fecha: pra saber quem chama o símbolo alterado, é preciso já saber, antes de buscar qualquer coisa, quais arquivos do repo inteiro referenciam aquele símbolo — e isso exige ou grafo do repo inteiro já construído, ou algum mecanismo de busca prévio. Nenhum dos dois existe se a indexação só olha os arquivos que a PR tocou. Rota corrigida: **indexação é ação separada e persistida por repo**, run de análise só consulta.

## Objetivos

- [ ] Callers do símbolo alterado aparecem no contexto de review (hoje ≈0% → meta ≥80% dos casos com caller relevante), incluindo callers em arquivos fora da PR — **capacidade implementada e testada** (`ranker.py`, caller transitivo confirmado em teste + demo real no Chrome); percentual em produção não medido (precisa de volume real de PRs)
- [x] Seleção de contexto é determinística: mesmo `repo@sha` + mesmo diff → mesmo contexto, sem LLM no meio
- [x] Nenhum símbolo entra cortado no meio — corte por fronteira de símbolo, nunca por offset de caractere
- [x] Repo nunca indexado ou falha de indexação degrada pro comportamento atual (regex), não quebra o run
- [x] Símbolo sem nenhum caller no grafo completo do repo é sinalizável como candidato a código morto

## Fora de escopo

| Item | Motivo |
|---|---|
| Embeddings / busca vetorial | Grafo é determinístico e resolve o problema; decisão consciente e documentada |
| Call graph interprocedural completo, resolução de tipo, dispatch dinâmico | Não necessário pro blast-radius; custo alto por sinal marginal |
| Linguagens além de TS/JS/Python | v1 cobre as duas linguagens de `apps/backend` e `apps/ai-api` |
| Reindexação automática por webhook (push/merge) | Não existe infra de GitHub App/webhook no repo hoje (confirmado: zero handler). v1 é reindex manual, acionado pelo usuário |
| GitHub App / Installation model | Repos hoje são listados via PAT pessoal do usuário (`repositories.service.ts`), sem conceito de instalação — fora de escopo mudar isso aqui |
| O eval harness do PRD 01 em si | Não implementado ainda no código (verificado: sem `false_positive_rate`/`rule_recall` no repo) — as métricas de sucesso desta feature assumem que esse harness existe. Tratado como dependência externa, não construído aqui |
| O servidor MCP do PRD 06 em si | Não implementado ainda — a story de consulta externa só expõe o grafo num formato que um tool MCP poderia consumir depois |
| Remoção de falso positivo de dead-code por análise de reflexão/DI dinâmica | v1 usa heurística de entrypoint conhecido (rotas exportadas, `main`, testes); métodos chamados só via reflexão/DI ficam fora, documentado como limitação |

---

## User Stories

### P1: Indexar repositório ⭐ MVP

**User Story**: Como usuário, quero indexar um repositório explicitamente (ação separada de rodar uma análise), pra ter o grafo de símbolos do repo inteiro disponível antes de qualquer PR ser revisada.

**Por que P1**: Sem isso, nenhuma outra story funciona — não dá pra achar caller de um símbolo sem já ter o repo inteiro parseado. É o fix de fundação, não incremental sobre o resolvedor atual.

**Correção pós-design (repo grande):** testado o fluxo pra repo de ~1k arquivos — buscar tudo e mandar numa `POST /index/build` só estoura limite de payload de proxy, segura o processo Node inteiro em memória, e trava a request do usuário até terminar (podendo passar de timeout de load balancer). Indexação vira **job assíncrono via BullMQ** (fila já roda sobre o Redis que o projeto já tem, `docker-compose.yml`): o endpoint enfileira e retorna na hora, um worker processa em background.

**Critérios de aceitação**:

1. QUANDO usuário aciona "indexar repositório" (ex: botão em `RepositoryCard.tsx`) ENTÃO backend DEVE enfileirar um job (BullMQ, fila `code-index`, `jobId` determinístico `{owner}/{repo}@{sha}`) e responder **imediatamente** com `202 { jobId, status: 'queued' }` — sem esperar o fetch do GitHub nem a chamada ao `ai-api`
2. QUANDO o worker processa o job ENTÃO DEVE buscar a árvore completa do repo via GitHub API (Trees API recursiva), enviar arquivos `.ts/.tsx/.js/.jsx/.py` pra `POST /index/build` no `ai-api`, e atualizar progresso do job (`job.updateProgress`) em pelo menos 2 pontos (fetch concluído, build concluído)
3. QUANDO um segundo "indexar" é acionado pro mesmo `owner/repo@sha` enquanto um job já está em fila ou rodando ENTÃO BullMQ DEVE ignorar o novo enqueue (dedupe nativo por `jobId` igual) — não cria job duplicado
4. QUANDO `ai-api` recebe `POST /index/build {repoId, sha, files}` ENTÃO DEVE parsear todos os arquivos via tree-sitter, montar grafo completo (nós = arquivo/símbolo, arestas = `defines/references/imports/tests`), e persistir como grafo real em Neo4j, com cada nó/relacionamento tageado por `repoId`/`sha` (revisão pós-design: banco de grafo nativo, não blob serializado — ver design.md)
5. QUANDO indexação de um arquivo individual falha (sintaxe inválida, linguagem não suportada) ENTÃO sistema DEVE pular só aquele arquivo, registrar em `stats`, e continuar indexando o resto — não aborta a indexação inteira
6. QUANDO indexação termina ENTÃO `ai-api` DEVE retornar `{indexId, stats: {indexedFiles, skippedFiles, durationMs}}`, e o job BullMQ DEVE marcar `completed` com esse resultado anexado
7. QUANDO import é resolvido durante a indexação ENTÃO sistema DEVE resolver relativo, depois alias (`tsconfig.json#paths`, `pyproject.toml`/`setup.cfg`), depois fallback por nome único no repo — igual à versão anterior deste spec, agora aplicado ao repo inteiro em vez de só arquivos da PR

**Teste independente**: Indexar um repo fixture com 3 níveis de call chain (`A chama B chama C`, `C` alterado numa PR fictícia); confirmar que `A` e `B` aparecem como caller transitivo no grafo persistido, mesmo sem nenhum dos dois estar na PR. Separadamente: acionar "indexar" 2x rápido pro mesmo repo, confirmar só 1 job roda (BullMQ dedupe).

---

### P2: Contexto de review consulta índice existente

**User Story**: Como agente reviewer, quero que o contexto do arquivo alterado inclua callers/callees/testes vindos do índice já construído do repo, sem reindexar nada durante o run da análise.

**Por que P2**: Run de análise fica rápido e barato (CPU-bound de parse não acontece por PR); e resolve a causa raiz do problema original (callers de fora da PR aparecem) porque agora existe visibilidade do repo inteiro via P1.

**Critérios de aceitação**:

1. QUANDO um run de análise começa pra um repo já indexado (mesmo `sha` ou `sha` anterior com índice válido) ENTÃO `change_analyzer` DEVE consultar o índice existente (sem reparsear nada) pra montar `relatedContext`
2. QUANDO ranking de candidatos relacionados roda ENTÃO sistema DEVE usar PageRank personalizado com peso 1.0 nos arquivos alterados pela PR, pesando aresta `references` de entrada (caller → alterado) mais que aresta `imports`
3. QUANDO montando `relatedContext` sob `tokenBudget` (default 8000) ENTÃO sistema DEVE alocar ~60% pros arquivos alterados (conteúdo completo), ~30% pros top vizinhos rankeados (corpo completo), ~10% pra cauda (só assinatura, estilo repo map)
4. QUANDO arquivo de teste (`**/*.spec.*`, `**/*.test.*`, `**/tests/**`, `test_*.py`) referencia símbolo definido em arquivo alterado ENTÃO sistema DEVE expor em `relatedContext.tests`
5. QUANDO o payload é montado ENTÃO `ChangedFileContext` DEVE ganhar `relatedContext: { callers, callees, tests, repoMap, stats }` junto do `relatedFiles` já existente
6. QUANDO `graph/utils/files_block` monta o prompt ENTÃO DEVE consumir `repoMap` + callers explícitos em vez do `slice()` cego atual contra `MAX_PROMPT_TOTAL_CHARS`
7. QUANDO o repo da PR **nunca foi indexado** (P1 nunca rodou pra esse repo) ENTÃO sistema DEVE degradar pro comportamento atual (sem `relatedContext`, ou fallback regex), sinalizar `stats.indexed = false`, e **não** disparar indexação completa dentro do run

**Teste independente**: Repo fixture indexado com ≥2 callers válidos em distâncias diferentes; confirmar que caller mais próximo/mais referenciado ranka acima, e confirmar que tokens totais do prompt ficam ≤ baseline atual. Repo fixture **não** indexado: confirmar run completa normalmente sem `relatedContext` e sem tentar indexar on-the-fly.

---

### P3: Reindexação incremental

**User Story**: Como usuário, quero reindexar um repo já indexado e ter só os arquivos alterados desde a última indexação reprocessados, pra reindex ser rápido mesmo em repo grande.

**Por que P3**: Indexação completa é cara (parse do repo inteiro); sem incremental, cada reindex custaria o mesmo que a primeira vez.

**Critérios de aceitação**:

1. QUANDO usuário aciona reindexação pra repo já indexado ENTÃO sistema DEVE reindexar só arquivos cujo hash de conteúdo difere do índice em cache
2. QUANDO indexação termina (fresh ou incremental) ENTÃO resposta `stats` DEVE reportar `indexedFiles`, `reusedFiles`, `budgetUsed`, `truncated`
3. QUANDO repo indexado é muito grande (acima de limite configurável de arquivos) ENTÃO sistema DEVE aplicar limite e sinalizar em `stats.truncated`, sem estourar tempo/memória
4. QUANDO frontend consulta status de um repo ENTÃO backend DEVE responder um de 4 estados: `not_indexed` / `queued` / `indexing` (com progresso do job BullMQ, se disponível) / `indexed` (com `sha` + `stale: boolean`) — consultando o job ativo (por `jobId` determinístico) quando existir, senão o `ai-api` (via `get_latest_sha`, CGC-26) pra saber o último sha indexado com sucesso

**Teste independente**: Indexar repo, alterar 1 arquivo, reindexar; confirmar que só aquele arquivo (+ vizinhos afetados no grafo) é reparseado, resto reaproveitado do cache.

---

### P4: Detecção de código morto

**User Story**: Como reviewer, quero saber quando um método/função criado ou alterado numa PR não tem nenhum caller no repo inteiro, pra sinalizar possível código morto.

**Por que P4**: Efeito colateral direto de ter o grafo completo do repo (P1) — símbolo com in-degree 0 em `references` é candidato natural, sem custo adicional de indexação.

**Critérios de aceitação**:

1. QUANDO um símbolo definido num arquivo alterado tem zero arestas `references` de entrada no grafo completo do repo ENTÃO sistema DEVE marcá-lo como candidato a código morto
2. QUANDO o símbolo é um entrypoint conhecido (rota exportada/decorada, `main`/`if __name__ == "__main__"`, símbolo exportado no `index.ts`/`__init__.py` do pacote, ou referenciado só por arquivo de teste) ENTÃO sistema NÃO DEVE marcá-lo como morto — heurística de exclusão obrigatória
3. QUANDO candidato a código morto é detectado ENTÃO `relatedContext` DEVE incluir campo `deadCodeCandidates: SymbolRef[]` pro agente reviewer sinalizar na review
4. QUANDO repo não está indexado (P1 nunca rodou) ENTÃO detecção de código morto DEVE ser omitida silenciosamente (não é erro, é ausência de dado)

**Teste independente**: Fixture com função nova sem nenhum caller e uma rota HTTP exportada sem caller interno (mas é entrypoint); confirmar que a função aparece em `deadCodeCandidates` e a rota não.

---

### P5: Expor grafo pra consulta externa (MCP-ready)

**User Story**: Como cliente MCP (do PRD 06, ainda não construído), quero consultar o grafo de código direto, pra agentes futuros com tool-calling puxarem contexto sob demanda.

**Por que P5**: Prioridade mais baixa — depende do PRD 06 (servidor MCP) que também é só proposta ainda. `POST /index/context` já existe desde P1/P2 como consequência natural da arquitetura (é o mesmo endpoint que `change_analyzer` usa internamente); esta story só garante que ele é chamável standalone.

**Critérios de aceitação**:

1. QUANDO `POST /index/context` é chamado com `{repoId, sha, changedFiles, tokenBudget}` ENTÃO sistema DEVE retornar `relatedContext` usando a mesma lógica de seleção do caminho in-run (P2), não implementação divergente
2. QUANDO nenhum servidor MCP existe ainda ENTÃO esse endpoint DEVE continuar chamável e testável de forma independente via HTTP direto

**Teste independente**: Chamar `/index/context` direto via HTTP contra repo fixture já indexado, confirmar mesmo formato/conteúdo de `relatedContext` que um run de agente ao vivo receberia.

---

### P6: Visualizar o grafo do repositório

**User Story**: Como usuário, ao entrar na página de um repositório já indexado, quero ver o grafo de código de forma visual (nós e conexões), pra explorar estrutura e dependências sem precisar rodar uma análise.

**Por que P6**: Efeito colateral do grafo já existir persistido (P1) — custo de construção é zero, só falta servir num formato consumível por UI. Prioridade mais baixa que P1-P4 (não afeta qualidade de review), mas fecha a promessa de "repo map" do doc original de forma tangível pro usuário.

**Critérios de aceitação**:

1. QUANDO usuário abre a visualização de grafo de um repo indexado ENTÃO sistema DEVE servir um subgrafo em formato nós/arestas consumível por lib de renderização, não o grafo bruto inteiro de uma vez
2. QUANDO o grafo completo excede um limite de nós renderizáveis ENTÃO sistema DEVE agregar por diretório/módulo por padrão (visão "zoomed out"), não travar o browser tentando desenhar tudo
3. QUANDO usuário clica num nó agregado (diretório/módulo) ou num símbolo ENTÃO sistema DEVE expandir a vizinhança (callers/callees) sob demanda — não carregar o repo inteiro de uma vez
4. QUANDO repo não está indexado ENTÃO view DEVE mostrar CTA pra indexar (reusa P1), não erro genérico

**Teste independente**: Repo fixture indexado com >200 nós; abrir view, confirmar que carga inicial é agregada (não 200 nós soltos), confirmar que clicar num diretório expande só aquela vizinhança.

---

## Casos de borda

- QUANDO símbolo é referenciado mas seu arquivo de definição foi deletado na mesma PR ENTÃO sistema DEVE excluir a referência pendurada, não crashar
- QUANDO dois arquivos definem símbolo com mesmo nome (sem módulo compartilhado) ENTÃO sistema NÃO DEVE cair pra resolução "símbolo único no repo" (esse fallback só vale quando o nome é de fato único no repo inteiro)
- QUANDO `tokenBudget` é menor que só os arquivos alterados já exigem ENTÃO sistema DEVE priorizar conteúdo completo dos arquivos alterados sobre qualquer conteúdo de vizinho, e reportar `truncated: true`
- QUANDO símbolo relacionado tecnicamente cabe no orçamento mas só como corpo parcial ENTÃO sistema DEVE rebaixar pra só-assinatura em vez de emitir corpo parcial
- QUANDO repo não tem `tsconfig.json`/`pyproject.toml` com path config ENTÃO resolução de alias DEVE ser no-op silencioso, caindo só pra resolução relativa + unicidade de símbolo
- QUANDO usuário roda análise de PR num repo cujo índice está desatualizado (commits novos desde a última indexação) ENTÃO sistema DEVE usar o índice existente mesmo assim (best-effort), sinalizando `stats.stale = true` — não bloqueia a análise esperando reindex
- QUANDO indexação de repo é acionada duas vezes em paralelo pro mesmo `repo@sha` ENTÃO sistema DEVE evitar trabalho duplicado (lock/dedupe por chave de cache), não construir dois índices concorrentes

---

## Rastreabilidade de requisitos

| ID | Story | Fase | Status |
|---|---|---|---|
| CGC-01 | P1: endpoint backend de indexação (busca árvore completa) | Implementado | Implementado |
| CGC-02 | P1: `POST /index/build` — parse tree-sitter + grafo completo | Implementado | Implementado |
| CGC-03 | P1: falha por-arquivo não aborta indexação inteira | Implementado | Implementado |
| CGC-04 | P1: `stats` de indexação (indexedFiles/skippedFiles/durationMs) | Implementado | Implementado |
| CGC-05 | P1: resolução de import (relativo/alias/fallback nome único) no repo inteiro | Implementado | Implementado |
| CGC-06 | P2: `change_analyzer` só consulta, nunca reindexa dentro do run | Implementado | Implementado |
| CGC-07 | P2: PageRank personalizado sobre índice existente | Implementado | Implementado |
| CGC-08 | P2: alocação de orçamento de token (60/30/10) | Implementado | Implementado |
| CGC-09 | P2: `relatedContext.tests` via aresta `tests` | Implementado | Implementado |
| CGC-10 | P2: formato do payload `relatedContext` | Implementado | Implementado |
| CGC-11 | P2: prompt builder consome `repoMap` | Implementado | Implementado |
| CGC-12 | P2: degradação graciosa quando repo nunca foi indexado | Implementado | Implementado |
| CGC-13 | P3: reindexação incremental por hash de arquivo | Implementado | Implementado |
| CGC-14 | P3: `stats` de reindex (indexedFiles/reusedFiles) | Implementado | Implementado |
| CGC-15 | P3: limite de arquivos em repo grande | Implementado | Implementado |
| CGC-16 | P3: status de indexação exibido no frontend | Implementado | Implementado |
| CGC-17 | P4: detecção de símbolo sem caller (in-degree 0) | Implementado | Implementado |
| CGC-18 | P4: heurística de exclusão de entrypoint | Implementado | Implementado |
| CGC-19 | P4: campo `deadCodeCandidates` no payload | Implementado | Implementado |
| CGC-20 | P5: `/index/context` chamável standalone | Implementado | Implementado |
| CGC-21 | P6: `GET /index/graph` serve subgrafo nós/arestas | Implementado | Implementado |
| CGC-22 | P6: agregação por diretório/módulo acima do limite renderizável | Implementado | Implementado |
| CGC-23 | P6: expansão de vizinhança sob demanda (lazy) | Implementado | Implementado |
| CGC-24 | P6: CTA de indexação quando repo não indexado | Implementado | Implementado |
| CGC-25 | P1: job assíncrono BullMQ — enqueue imediato (202) + dedupe por `jobId` determinístico | Implementado | Implementado |
| CGC-26 | P3: `get_latest_sha` — Neo4j rastreia último sha indexado por repo (nó `:RepoIndex`) | Implementado | Implementado |

**Cobertura:** 26 total, 26 implementados, 0 sem mapeamento ✅

---

## Critérios de sucesso

- [ ] ≥80% dos casos com caller relevante têm ele presente em `relatedContext`, incluindo callers fora da PR (hoje: ~0%) — não medido em produção, sem volume real de PRs ainda
- [ ] Tokens de prompt por review ≤ baseline atual, com aumento de sinal — não medido em produção
- [x] Zero indexação disparada de forma síncrona dentro de um run de análise (CGC-06) — `change_analyzer` só consulta (`assemble_related_context`/`cache.lookup`), nunca chama `index_files`/`build_graph`; testado
- [x] Reindex incremental de 1 arquivo alterado processa em tempo proporcional à vizinhança afetada, não ao repo inteiro — `build_incremental`, testado com contagem de reparse (T19)
- [ ] `false_positive_rate` −30% relativo, `rule_recall` +10% relativo — **bloqueado no eval harness do PRD 01 existir**; não medível até isso ser construído

---

## Dependências e riscos

| Item | Nota |
|---|---|
| Eval harness do PRD 01 | Não implementado — métricas de regressão do CGC não são medíveis sem ele |
| Dependência nativa tree-sitter | Sem `tree-sitter`/`networkx` em `apps/ai-api/requirements.txt` hoje |
| Custo de indexação full-repo inicial | Primeira indexação de repo grande é cara (repo inteiro, não incremental) — mitigado por CGC-15 (limite configurável) e por ser ação explícita do usuário, não bloqueante de análise |
| Sem GitHub App/webhook | Reindex é manual — repo pode ficar desatualizado entre indexações; UX precisa deixar isso visível (CGC-16), não é bug, é limitação de v1 documentada |
| Falso positivo em dead-code (reflexão/DI dinâmica) | Documentado como limitação de v1 (heurística de entrypoint conhecido, não análise de runtime) |
| PRD 06 MCP server | P5 só garante endpoint chamável; a integração MCP em si é fora de escopo aqui |
