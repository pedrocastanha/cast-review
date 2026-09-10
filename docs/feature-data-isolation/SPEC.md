# SPEC: Isolamento de dados entre usuários (RLS, grafo e workers)

**Status:** Draft para revisão
**Data:** 2026-09-09
**Escopo:** PostgreSQL RLS, roles de banco, contexto transacional, workers, Neo4j, Redis e contratos do `ai-api`
**Depende de:** [SPEC de production readiness](../feature-production-readiness/SPEC.md), itens SEC-14 a SEC-20

## 1. Resultado esperado

Hoje a autorização do Cast é uma barreira só: o service layer filtra por dono em cada consulta. Funciona, mas um único `findOne` sem `where` de dono, um endpoint novo esquecido ou um worker rodando sem ator viram vazamento entre contas — sem nada abaixo para segurar.

Ao final desta SPEC, atravessar a autorização exige furar duas camadas independentes:

```text
Requisição autenticada
        │
        ▼
Service layer  ── filtra por dono (o que já existe hoje)
        │
        ▼
PostgreSQL     ── role sem BYPASSRLS + policy por linha         ◄── nova
        │
        ▼
Neo4j          ── toda leitura filtrada por tenant, sem exceção  ◄── nova
```

O teste que define sucesso é direto: com a credencial de runtime da aplicação, uma query SQL crua, sem passar pelo service layer e sem `app.user_id` definido, não devolve **nenhuma** linha de negócio. E um usuário não enxerga o grafo de código de um repositório que ele não tem autorização para ler, mesmo conhecendo o `repoId` exato.

## 2. Baseline verificado

Cada item abaixo foi conferido no código e no schema em 2026-09-09, não é suposição.

| # | Achado | Evidência |
|---|---|---|
| B-01 | Nenhuma policy de RLS existe. Nenhuma migration habilita `ROW LEVEL SECURITY` em tabela alguma. | 26 migrations, nenhuma com `ENABLE ROW LEVEL SECURITY` |
| B-02 | Runtime e migrations usam a mesma credencial. O runtime tem DDL completo. | `postgres.datasource.ts` usa `DB_USER`; `scripts/migrate.cjs` aceita `MIGRATION_DATABASE_URL` mas nada impede que sejam o mesmo usuário |
| B-03 | Consultas rodam fora de transação. `DefaultRepository` chama `datasource.getRepository()` direto; o `EntityManager` é opcional e usado só em casos pontuais. | `src/shared/database/postgres/default.database.ts` |
| B-04 | `analyses.requested_by` **não tem foreign key** para `users`. Apagar um usuário deixa análises órfãs com conteúdo de repositório. | `pg_constraint`: nenhuma FK de `analyses` para `users` |
| B-05 | O grafo do Neo4j é escopado só por `repoId`/`sha`. Dois usuários que indexem o mesmo `repoId` compartilham os mesmos nós. | `app/code_graph/cache.py`, docstring assume "no multi-tenancy at the database level" |
| B-06 | `list_repositories` faz `MATCH (r:RepoIndex)` **sem nenhum filtro de tenant** — enumera todo repositório indexado na instância. | `app/code_graph/cache.py:147-176` |
| B-07 | O job de review carrega só `{ reviewRunId }`. O ator é derivado de `installation.ownerUserId`, que é nullable e usado com `as string`. | `github-review-queue.constants.ts`, `review.processor.ts:154,178,312` |
| B-08 | O lock de indexação vive num namespace Redis compartilhado: `idxlock:{repoId}:{sha}`. | `app/code_graph/cache.py:30` |
| B-09 | O grant do catálogo de chat é assinado com `SECRET_ENCRYPTION_KEY` — a chave de criptografia reusada como chave de MAC — e carrega o objeto de usuário inteiro, com e-mail. | `chat-catalog-grant.service.ts` |
| B-10 | `benchmark_cases.owner_id` é nullable: `NULL` significa caso curado (catálogo público). Precisa de policy explícita, senão vira leitura de todo mundo ou de ninguém. | schema: `benchmark_cases.owner_id uuid NULL` |
| B-11 | `github_installations.owner_user_id` é nullable com `ON DELETE SET NULL`. Instalação órfã não pode pertencer a ninguém. | `pg_constraint`: `confdeltype = n` |

Os itens B-04, B-06, B-07 e B-09 são falhas independentes de RLS e podem ser corrigidos antes dela.

## 3. Objetivos

1. Toda tabela de negócio nega leitura e escrita por padrão, liberando apenas o que o contexto verificado autoriza.
2. O runtime da aplicação perde a capacidade de contornar policy e de executar DDL.
3. Todo acesso autenticado carrega contexto de ator, inclusive em workers e webhooks.
4. O grafo de código para de ser um espaço global compartilhado.
5. Um teste de regressão prova o isolamento por fora do service layer, com SQL cru.

## 4. Fora de escopo

- Compartilhamento de projeto entre múltiplos usuários (organizações/times). O modelo aqui é um dono por recurso; multi-membro entra depois, e a Seção 6 deixa o gancho pronto.
- Criptografia de campo além do que já existe para PAT e chave da OpenAI.
- Migrar o Neo4j para Enterprise só para ganhar multi-database.
- Reescrever o service layer. As checagens atuais **permanecem**; RLS é rede, não substituto.

## 5. Decisões de arquitetura

| ID | Decisão | Motivo |
|---|---|---|
| D-01 | RLS `ENABLE` **e** `FORCE` em toda tabela de negócio. `FORCE` faz a policy valer inclusive para o dono da tabela. | Sem `FORCE`, o owner do schema ignora policy silenciosamente. |
| D-02 | Três roles: `cast_migration` (DDL, dono das tabelas), `cast_runtime` (DML, sem `BYPASSRLS`, sem DDL) e `cast_worker` (igual ao runtime, com policy de serviço adicional). | Separar quem altera schema de quem serve tráfego é o que dá sentido ao `FORCE`. |
| D-03 | O contexto vai em `SET LOCAL app.user_id` / `app.actor_type` dentro de transação, nunca `SET` de sessão. | `SET LOCAL` morre no fim da transação; `SET` vazaria contexto entre requisições que reusam a mesma conexão do pool. |
| D-04 | Toda requisição autenticada roda dentro de uma transação, aberta por interceptor e propagada via `AsyncLocalStorage`. | O projeto já usa esse padrão em `request-credentials.ts`; reusar evita tocar os ~10 pontos que consultam o banco. |
| D-05 | O ator de um job é **explícito no payload** (`actorUserId`, `actorType`), nunca derivado de uma coluna nullable no momento da execução. | B-07: hoje um `ownerUserId` nulo viraria `undefined` como ator. |
| D-06 | Ingestão de webhook roda como `actor_type = 'service'`, com policy própria e restrita às tabelas de ingestão. | O delivery chega antes de existir qualquer usuário no contexto. |
| D-07 | No Neo4j, todo nó e relação de conteúdo carrega `tenantId`, e **toda** query filtra por ele. Neo4j Community não tem multi-database, então o isolamento é por propriedade + disciplina de query. | `docker-compose.yml` usa `neo4j:5-community`. |
| D-08 | O backend autoriza `repoId → usuário` **antes** de qualquer chamada ao `ai-api`, e o `ai-api` filtra por `tenantId` de novo. | Duas camadas: um erro no backend não vira vazamento no grafo. |
| D-09 | Chaves de Redis de conteúdo e coordenação recebem prefixo de tenant. | B-08: namespace compartilhado permite colisão e inferência entre contas. |
| D-10 | O grant do catálogo ganha segredo próprio (`CHAT_GRANT_SECRET`) e passa a carregar só `userId`, não o objeto de usuário. | B-09: chave de criptografia não deve ser chave de assinatura, e e-mail não precisa trafegar. |

## 6. Modelo de ownership

`app.user_id` é o UUID do usuário verificado pelo guard. A coluna de derivação de cada tabela:

| Tabela | Predicado da policy |
|---|---|
| `users` | `id = app.user_id` |
| `refresh_sessions` | `user_id = app.user_id` |
| `projects` | `owner_id = app.user_id` |
| `project_repositories` | projeto pertence ao usuário |
| `analyses` | `requested_by = app.user_id` |
| `analysis_context_snapshots` | análise pertence ao usuário |
| `chat_threads` | `user_id = app.user_id` |
| `chat_messages` | thread pertence ao usuário |
| `feature_cards` | projeto pertence ao usuário |
| `feature_card_revisions` | card pertence ao usuário |
| `finding_cases` | `requested_by = app.user_id` |
| `finding_occurrences` | caso pertence ao usuário |
| `finding_case_events` | caso pertence ao usuário |
| `architecture_maps` | `owner_id = app.user_id` |
| `architecture_map_versions` | mapa pertence ao usuário |
| `architecture_capabilities` | mapa pertence ao usuário |
| `architecture_components` | mapa pertence ao usuário |
| `architecture_boundaries` | mapa pertence ao usuário |
| `benchmark_cases` | `owner_id = app.user_id` para escrita; leitura também permite `owner_id IS NULL` (catálogo curado) |
| `benchmark_runs` | caso pertence ao usuário, pelas regras acima |
| `github_installations` | `owner_user_id = app.user_id`; `NULL` não pertence a ninguém |
| `github_app_repositories` | instalação pertence ao usuário |
| `github_webhook_deliveries` | instalação pertence ao usuário; escrita só por `actor_type = 'service'` |
| `github_review_runs` | instalação pertence ao usuário; escrita só por `actor_type = 'service'` |

**ISO-01.** `analyses.owner` e `github_*.owner` são o login da organização no GitHub, **não** o usuário do Cast. Nenhuma policy pode usar essas colunas. A coluna de dono em `analyses` é `requested_by`.

**ISO-02.** As policies indiretas (`EXISTS` no pai) precisam que a tabela pai também esteja sob RLS, senão o `EXISTS` enxerga linhas que a policy filha deveria esconder. A ordem de habilitação segue pai antes de filho.

**ISO-03.** Toda policy cobre `SELECT`, `INSERT`, `UPDATE` e `DELETE` separadamente. `INSERT` usa `WITH CHECK`, para impedir que alguém crie linha com dono alheio.

**ISO-04.** `benchmark_cases` com `owner_id IS NULL` é somente leitura pelo runtime. Só a role de migration semeia catálogo curado.

## 7. Roles e conexão

**ROLE-01.** `cast_migration` é dona das tabelas, tem DDL, e é usada exclusivamente pelo release job. Nunca é configurada no runtime.

**ROLE-02.** `cast_runtime` recebe `SELECT, INSERT, UPDATE, DELETE` nas tabelas de negócio e `USAGE` no schema. Sem `SUPERUSER`, sem `BYPASSRLS`, sem `CREATE`.

**ROLE-03.** O boot valida a role em produção e falha fechado se ela puder contornar RLS:

```sql
SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
```

Qualquer um dos dois verdadeiro encerra o processo. Essa checagem entra em `validateProductionConfig()`, junto das que já existem.

**ROLE-04.** `MIGRATION_DATABASE_URL` e as variáveis `DB_*` do runtime devem apontar para usuários diferentes em produção. O boot recusa se forem iguais.

## 8. Contexto transacional

**CTX-01.** Um interceptor global abre transação para toda requisição autenticada, executa

```sql
SELECT set_config('app.user_id', $1, true);
SELECT set_config('app.actor_type', $2, true);
```

e disponibiliza o `EntityManager` da transação por `AsyncLocalStorage`, no mesmo formato já usado por `request-credentials.ts`.

**CTX-02.** O segundo argumento sai do usuário que o guard verificou. Nunca de body, query, header ou payload de job não assinado.

**CTX-03.** `DefaultRepository` passa a preferir o manager do contexto quando existir, mantendo o parâmetro `manager` explícito de hoje para os casos que já o usam. Nenhuma assinatura pública muda.

**CTX-04.** Rotas públicas (`/health`, `/instance`, login, registro, refresh, demo) não abrem contexto de usuário. As consultas que elas fazem — buscar usuário por e-mail no login, criar conta, girar refresh token — precisam de policy de serviço, porque acontecem antes de existir um `app.user_id`. Essas operações ficam concentradas em `AuthService` e `UserService` e rodam sob `actor_type = 'service'`.

**CTX-05.** SSE é um caso especial: a resposta dura minutos, e manter uma transação aberta durante todo o stream prenderia uma conexão do pool. O contexto vale para as leituras e escritas em volta do stream; cada escrita durante o stream abre a própria transação curta, com o mesmo contexto. Nenhuma transação fica aberta esperando o LLM.

## 9. Workers e jobs

**JOB-01.** O payload de todo job passa a carregar `actorUserId` e `actorType` explícitos. Para o review automático, `GithubReviewJobData` vira `{ reviewRunId, actorUserId }`.

**JOB-02.** O job é rejeitado no enqueue se `actorUserId` for nulo. Isso corrige B-07 na origem: hoje uma instalação órfã produziria um job que roda com ator indefinido.

**JOB-03.** O worker abre o mesmo contexto transacional antes de tocar em qualquer dado, com o ator do payload.

**JOB-04.** O worker revalida a autorização no momento da execução — o vínculo instalação→usuário pode ter sido desfeito entre o enqueue e a execução. Ator do payload que não bate mais com o dono atual encerra o job como `skipped`, não como erro.

**JOB-05.** Job sem dono humano (limpeza de retenção, purga de visitantes) roda como `actor_type = 'service'` e só toca tabelas e linhas que a policy de serviço libera.

## 10. Isolamento no grafo

**GRAPH-01.** O `tenantId` de um repositório indexado é o usuário Cast que autorizou a indexação. Todo nó `Symbol`, `ApiEndpoint` e `RepoIndex`, e toda relação entre eles, carrega `tenantId`.

**GRAPH-02.** Toda query do `IndexCache` filtra por `tenantId`. Não existe query de conteúdo sem esse filtro — incluindo `DETACH DELETE`, que hoje apaga por `repoId` e apagaria o índice de outro usuário.

**GRAPH-03.** `list_repositories` deixa de existir na forma atual. A listagem passa a receber `tenantId` obrigatório e devolve só o que pertence a ele. Sem `tenantId`, a rota responde 400, não uma lista vazia — vazio esconde erro de chamada.

**GRAPH-04.** O `ai-api` rejeita requisição de conteúdo sem `tenantId` no corpo. O backend preenche a partir do usuário verificado, nunca do que o cliente mandou.

**GRAPH-05.** Antes de qualquer chamada ao `ai-api`, o backend confirma que o `repoId` pertence ao usuário, via `project_repositories` ou via instalação da GitHub App. Um `repoId` não autorizado nunca vira chamada.

**GRAPH-06.** Índices no Neo4j passam a ser compostos por `(tenantId, repoId, sha)`. Índice só em `repoId` degrada a query com o filtro novo.

**GRAPH-07.** A migração do grafo existente é destrutiva por decisão: os índices atuais não têm `tenantId` e não há como inferir o dono com segurança. O grafo é cache reconstruível — apaga e reindexa. Isso precisa estar no runbook do deploy, não como surpresa.

**GRAPH-08.** Um mesmo repositório indexado por dois usuários vira dois subgrafos. Custa espaço e reindexação duplicada; é o preço do isolamento enquanto não existir modelo de compartilhamento. A Seção 4 registra que compartilhamento entra depois.

## 11. Redis

**REDIS-01.** O lock de indexação passa a `idxlock:{tenantId}:{repoId}:{sha}`.

**REDIS-02.** Checkpoints do LangGraph são endereçados por `analysisId`/`threadId`, que são UUIDs de posse do usuário. O `ai-api` não verifica posse — confia no backend, que já filtra por `requested_by` antes de retomar. Essa confiança vira contrato escrito: o backend **precisa** autorizar antes de retomar, e o teste de regressão cobre isso.

**REDIS-03.** Contadores de rate limit e outras chaves operacionais continuam globais. Não carregam conteúdo.

## 12. Correções independentes

Cada uma fecha um achado do baseline e não depende de RLS:

**FIX-01 (B-04).** Adicionar FK `analyses.requested_by → users(id) ON DELETE CASCADE`. A migration precisa limpar órfãos antes de criar a constraint, e o número de linhas afetadas deve ser reportado no log do release.

**FIX-02 (B-09).** `CHAT_GRANT_SECRET` próprio para o grant do catálogo, com validação no boot. O payload passa a carregar `userId` e `threadId`, sem e-mail nem objeto de usuário.

**FIX-03 (B-07).** `actorUserId` no payload do job, com rejeição no enqueue.

**FIX-04 (B-06).** `tenantId` obrigatório em `list_repositories`.

## 13. Testes obrigatórios

O critério é que cada teste falhe se a proteção for removida. Testes que passam com e sem a policy não contam.

### 13.1 Isolamento por SQL cru

Executados com a role `cast_runtime`, conexão direta, **sem** passar pelo service layer:

| Cenário | Esperado |
|---|---|
| `SELECT * FROM projects` sem `app.user_id` definido | zero linhas |
| idem para todas as 22 tabelas de negócio | zero linhas |
| `SELECT` com `app.user_id` do usuário A | só linhas de A |
| `UPDATE ... WHERE id = <linha de B>` com contexto de A | zero linhas afetadas |
| `DELETE ... WHERE id = <linha de B>` com contexto de A | zero linhas afetadas |
| `INSERT` de projeto com `owner_id` de B, contexto de A | rejeitado pelo `WITH CHECK` |
| `INSERT` de card em projeto de B, contexto de A | rejeitado |
| `SELECT` em `benchmark_cases` curado (`owner_id IS NULL`) | visível |
| `UPDATE` em caso curado | zero linhas afetadas |
| `SELECT` em instalação órfã (`owner_user_id IS NULL`) | zero linhas |
| `CREATE TABLE` com a role de runtime | negado |
| `ALTER TABLE ... DISABLE ROW LEVEL SECURITY` com a role de runtime | negado |

### 13.2 Contexto

| Cenário | Esperado |
|---|---|
| duas requisições concorrentes de usuários diferentes na mesma instância | cada uma enxerga só o seu |
| contexto após o fim da transação | `app.user_id` vazio na próxima query da mesma conexão |
| exceção no meio da requisição | transação revertida, contexto limpo |
| job com `actorUserId` nulo | rejeitado no enqueue |
| job cujo dono mudou entre enqueue e execução | encerrado como `skipped` |
| ingestão de webhook sem usuário | grava só nas tabelas de ingestão |

### 13.3 Grafo

| Cenário | Esperado |
|---|---|
| usuário B pede contexto de `repoId` indexado por A | negado no backend, antes do `ai-api` |
| chamada direta ao `ai-api` com `tenantId` de A e `repoId` de A, autenticada como serviço | devolve dados de A |
| mesma chamada com `tenantId` de B | zero resultados, não erro |
| requisição de conteúdo sem `tenantId` | 400 |
| listagem de repositórios | só os do `tenantId` |
| reindexação de A não apaga o subgrafo de B para o mesmo `repoId` | subgrafo de B intacto |

### 13.4 Regressão

A suíte inteira que já existe (596+ unitários, 63 e2e) precisa continuar verde. RLS quebra silenciosamente consultas que dependiam de ver tudo; a suíte atual é o detector.

## 14. Ordem de execução

**Fase 0 — Correções independentes.** FIX-01 a FIX-04. Entregáveis pequenos, testáveis, sem risco de quebrar leitura.

**Fase 1 — Roles e contexto, sem policy.** Criar as roles, separar as credenciais, subir o interceptor de contexto e o `AsyncLocalStorage`. Com RLS ainda desligado, nada muda no comportamento — mas dá para verificar que `app.user_id` está definido em toda requisição. Um log em ambiente de teste contando requisições sem contexto mostra o que ficou de fora antes de qualquer policy existir.

**Fase 2 — Policies, tabela por tabela.** Habilitar por grupo, do pai para o filho, rodando a suíte a cada grupo. A ordem sugerida: `users` e `refresh_sessions`; `projects` e dependentes; `analyses` e dependentes; `chat`; `architecture`; `benchmarks`; `github_*`.

**Fase 3 — Workers.** Ator explícito, revalidação e policy de serviço.

**Fase 4 — Grafo.** `tenantId`, queries filtradas, purga e reindexação.

**Fase 5 — Testes de isolamento no CI.** A suíte de SQL cru vira gate obrigatório.

Fases 1 e 2 são as que podem quebrar produção de forma difícil de diagnosticar. Merecem ir para staging isoladas, sem outra mudança junto.

## 15. Critérios de aceite

1. Nenhuma tabela de negócio devolve linha para a role de runtime sem `app.user_id`.
2. A role de runtime não consegue executar DDL nem desabilitar RLS.
3. O boot em produção falha se a role puder contornar RLS ou se runtime e migration compartilharem credencial.
4. Toda requisição autenticada tem contexto de ator; toda execução de job também.
5. Dois usuários não atravessam autorização nem pelo backend nem por SQL direto.
6. Nenhuma query de conteúdo no Neo4j roda sem filtro de `tenantId`.
7. Um `repoId` não autorizado não vira chamada ao `ai-api`.
8. A suíte existente continua verde, e a suíte de isolamento é gate obrigatório.
9. O runbook de deploy registra a purga e reindexação do grafo.

## 16. Riscos e decisões a confirmar

**Risco: `EXISTS` em cadeia custa caro.** Policies indiretas viram subconsulta em toda linha. `feature_card_revisions` chega a três saltos até `projects`. Precisa de índice em toda coluna de junção e de medição antes e depois nas rotas de listagem. Se doer, o caminho é desnormalizar `owner_id` nas tabelas folha — o que troca custo de leitura por risco de dessincronização, e isso é decisão a tomar com número na mão, não agora.

**Risco: a transação por requisição muda o comportamento sob erro.** Hoje uma escrita que falha no meio de um handler deixa as anteriores gravadas. Depois, tudo reverte. É mais correto, mas é mudança de semântica — pode expor fluxos que dependiam do parcial.

**Risco: pool de conexões sob SSE.** A Seção 8 já separa o stream do contexto, mas o comportamento sob carga real precisa de medição antes de produção.

**A confirmar:**

- `benchmark_cases` curado é visível para todo mundo ou só para autenticados? A SPEC assume autenticados.
- Uma instalação da GitHub App órfã deve ser apagada ou mantida inerte? A SPEC assume inerte e invisível.
- O grafo duplicado por usuário (GRAPH-08) é aceitável no curto prazo, ou o compartilhamento por projeto precisa entrar já nesta rodada?
- Retenção de análises de visitante: hoje a purga apaga com o usuário. Vale valer também para conta real, com prazo?

## 17. Referências

- [SPEC de production readiness](../feature-production-readiness/SPEC.md) — SEC-14 a SEC-20
- [Estado da implementação](../feature-production-readiness/IMPLEMENTATION.md) — pendências 1 e 2
- [Architecture do backend](../ARCHITECTURE-backend.md)
- [PostgreSQL: Row Security Policies](https://www.postgresql.org/docs/16/ddl-rowsecurity.html)
- [PostgreSQL: `set_config`](https://www.postgresql.org/docs/16/functions-admin.html)
