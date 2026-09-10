# RLS no PostgreSQL

Data: 2026-09-09. Cobre a pendência 1 de `IMPLEMENTATION.md` e os requisitos SEC-14 a SEC-19 do `SPEC.md`.

## Estado

Implementado e verificado contra Postgres real (`test/rls-isolation.e2e-spec.ts`, 17 casos).

| Peça | Onde |
|---|---|
| Bootstrap de roles | `apps/backend/scripts/sql/00-roles.sql` |
| Verificação de falha fechada | `apps/backend/scripts/sql/01-verify-roles.sql` |
| Migration de RLS | `src/shared/database/postgres/migrations/1789000000000-EnableRowLevelSecurity.ts` |
| Escopo do ator | `src/shared/database/postgres/db-actor.ts` |
| Transação com contexto | `src/shared/database/postgres/rls-context.ts`, `rls.transaction.ts` |
| Injeção automática | `src/shared/database/postgres/default.database.ts` |
| Teste SEC-19 | `test/rls-isolation.e2e-spec.ts` |

**As policies só passam a valer depois de rodar `00-roles.sql` e apontar `DB_USER` para `cast_runtime`.** Enquanto o runtime conectar como dono das tabelas, a policy `_maintenance` o libera — de propósito, para o rollout ser gradual. O item 5 do checklist é o que fecha isso.

---

## 0. Decisão de arquitetura: unidade de trabalho, não request

SEC-16 diz que "uma requisição autenticada começa uma transação". **Não implementar ao pé da letra.**

`SSE_MAX_DURATION_MS` tem default de 900_000 (`src/shared/security/production-config.ts:97`). Envolver o request inteiro numa transação significa segurar uma conexão do pool por até 15 minutos por stream, com `SSE_MAX_STREAMS_TOTAL` de 200. O pool acaba e o autovacuum trava atrás da transação mais antiga.

O escopo correto é a **unidade de trabalho**:

- o ator (`userId` + `actorType`) vive num `AsyncLocalStorage`, estabelecido por middleware e preenchido pelo guard;
- cada bloco que toca o banco abre sua própria transação curta e injeta o contexto via `set_config`.

Consequência não negociável: `set_config(..., true)` é transaction-local. Fora de uma transação explícita o valor não sobrevive ao statement. **Toda query sob RLS precisa rodar dentro de uma transação.**

---

## 1. Roles e bootstrap

Fora do TypeORM — exige superuser. Novo arquivo `apps/backend/scripts/sql/00-roles.sql`, executado uma vez pelo administrador do banco.

```sql
CREATE ROLE cast_migrator LOGIN PASSWORD :'migrator_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
CREATE ROLE cast_runtime  LOGIN PASSWORD :'runtime_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

ALTER DATABASE portfolio OWNER TO cast_migrator;
ALTER SCHEMA public OWNER TO cast_migrator;

-- as tabelas atuais pertencem a "portfolio"
REASSIGN OWNED BY portfolio TO cast_migrator;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO cast_runtime;

CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION cast_migrator;
GRANT USAGE ON SCHEMA app TO cast_runtime;
```

Depois: `MIGRATION_DATABASE_URL` aponta para `cast_migrator`, `DB_USER` para `cast_runtime`.

`NOBYPASSRLS` no runtime é obrigatório e **não é suficiente**: o dono da tabela ignora RLS por padrão. Por isso `cast_runtime` nunca pode ser dono, e por isso a seção 2.3 usa `FORCE`.

---

## 2. Migration de RLS

Migration nova, sugestão `1789000000000-EnableRowLevelSecurity.ts`, executada como `cast_migrator`.

### 2.1 Funções de contexto

```sql
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app.actor_type() RETURNS text
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT COALESCE(NULLIF(current_setting('app.actor_type', true), ''), 'anonymous')
$$;
```

- `STABLE`, nunca `IMMUTABLE`. `IMMUTABLE` permite ao planner cachear o valor entre transações — vazamento silencioso entre usuários.
- O segundo argumento `true` de `current_setting` devolve NULL em vez de erro quando a variável não foi setada.
- Contexto ausente produz NULL, e `coluna = NULL` nunca é TRUE. O default é negar, conforme SEC-14.

### 2.2 Grants

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO cast_runtime;
ALTER DEFAULT PRIVILEGES FOR ROLE cast_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cast_runtime;
REVOKE ALL ON TABLE migrations FROM cast_runtime;
```

### 2.3 Ligar RLS

Para cada tabela de negócio:

```sql
ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
ALTER TABLE <t> FORCE  ROW LEVEL SECURITY;
CREATE POLICY <t>_migrator ON <t> TO cast_migrator USING (true) WITH CHECK (true);
```

`FORCE` fecha o buraco de alguém apontar `DB_USER` para o dono em produção — falha fechada. A policy nomeada devolve acesso total ao migrator, que precisa de DML cross-user em data migrations. Policies são permissivas e combinadas por OR, então não há conflito.

### 2.4 Policies de dono direto

```sql
CREATE POLICY <t>_owner ON <t>
  FOR ALL TO cast_runtime
  USING      (<col> = app.current_user_id())
  WITH CHECK (<col> = app.current_user_id());
```

| Tabela | Coluna |
|---|---|
| `users` | `id` |
| `projects` | `owner_id` |
| `analyses` | `requested_by` |
| `finding_cases` | `requested_by` |
| `architecture_maps` | `owner_id` |
| `chat_threads` | `user_id` |
| `benchmark_runs` | `requested_by` |
| `github_installations` | `owner_user_id` |

`WITH CHECK` não é opcional. Sem ele o usuário insere linhas com dono alheio e reatribui `owner_id` para fora do próprio escopo em UPDATE.

`benchmark_cases` é misto (`kind: 'curated' | 'private'`):

```sql
CREATE POLICY benchmark_cases_read ON benchmark_cases
  FOR SELECT TO cast_runtime
  USING (kind = 'curated' OR owner_id = app.current_user_id());

CREATE POLICY benchmark_cases_write ON benchmark_cases
  FOR ALL TO cast_runtime
  USING      (kind = 'private' AND owner_id = app.current_user_id())
  WITH CHECK (kind = 'private' AND owner_id = app.current_user_id());
```

### 2.5 Policies de dono indireto

Padrão `EXISTS` sobre a tabela pai. A subquery também aplica a RLS do pai, então o encadeamento é automático.

```sql
CREATE POLICY chat_messages_owner ON chat_messages
  FOR ALL TO cast_runtime
  USING (EXISTS (
    SELECT 1 FROM chat_threads t
    WHERE t.id = chat_messages.thread_id
      AND t.user_id = app.current_user_id()))
  WITH CHECK (EXISTS (
    SELECT 1 FROM chat_threads t
    WHERE t.id = chat_messages.thread_id
      AND t.user_id = app.current_user_id()));
```

| Tabela | FK | Pai |
|---|---|---|
| `chat_messages` | `thread_id` | `chat_threads` |
| `analysis_context_snapshots` | `analysis_id` | `analyses` |
| `finding_occurrences` | `case_id` | `finding_cases` |
| `finding_case_events` | `case_id` | `finding_cases` |
| `architecture_capabilities` | `map_id` | `architecture_maps` |
| `architecture_components` | `map_id` | `architecture_maps` |
| `architecture_boundaries` | `map_id` | `architecture_maps` |
| `architecture_map_versions` | `map_id` | `architecture_maps` |
| `project_repositories` | `project_id` | `projects` |
| `feature_cards` | `project_id` | `projects` |
| `github_app_repositories` | `installation_id` | `github_installations` |
| `github_review_runs` | `installation_id` | `github_installations` |

Dois saltos, `feature_card_revisions` → `feature_cards` → `projects`:

```sql
USING (EXISTS (
  SELECT 1 FROM feature_cards c
  JOIN projects p ON p.id = c.project_id
  WHERE c.id = feature_card_revisions.card_id
    AND p.owner_id = app.current_user_id()))
```

Índice na FK é pré-requisito de performance: a policy é avaliada por linha. Já existem índices compostos cobrindo `chat_messages.thread_id`, `finding_*.case_id`, `architecture_*.map_id` e `feature_cards.project_id`. Conferir `github_review_runs.installation_id` e `feature_card_revisions.card_id`.

### 2.6 Tabelas condicionais

`posts` é resíduo do template Nest: existe em bancos antigos, não é criada por nenhuma migration e não tem entity nem uso no código. A migration checa `to_regclass` antes de tocar cada tabela, então é idempotente entre ambientes.

### 2.7 Tabelas fora do padrão

Errar aqui quebra o login.

- **`refresh_sessions`** — consultada por `token_hash` antes de existir usuário autenticado (`src/modules/auth/refresh-session.repository.ts:46`). Uma policy baseada em `user_id` mata o refresh.
  ```sql
  CREATE POLICY refresh_sessions_scope ON refresh_sessions
    FOR ALL TO cast_runtime
    USING (app.actor_type() = 'auth' OR user_id = app.current_user_id())
    WITH CHECK (app.actor_type() = 'auth' OR user_id = app.current_user_id());
  ```
- **`users` no login** — `SELECT ... WHERE email = $1` (`src/modules/users/user.service.ts:356`) devolve, por definição, a linha de alguém que ainda não se autenticou.
  ```sql
  CREATE POLICY users_auth_bootstrap ON users
    FOR SELECT TO cast_runtime
    USING (app.actor_type() = 'auth');
  ```
  `actor_type = 'auth'` é setado exclusivamente dentro do `AuthService`, em queries nomeadas. É um buraco deliberado e auditável — manter documentado e coberto por teste.
- **`github_webhook_deliveries`** — webhook não tem usuário. Policy sobre `app.actor_type() = 'service'`.
- **`migrations`** — sem RLS e sem grant para o runtime.
- **Expurgo de contas demo** (`UserService.purgeExpiredGuests`) — roda sem dono humano, como `actor_type = 'job'`. Duas policies: `users_demo_reaper` e `analyses_demo_reaper`, ambas limitadas a linhas cujo usuário tem `demo_expires_at` preenchido. Conta real fica fora do alcance.
- **`github_installations` no webhook** — o handler precisa achar a instalação pelo `installation_id` do payload antes de saber de quem ela é. `github_installations_service_bootstrap` abre só o SELECT sob `actor_type = 'service'`; assim que a instalação é resolvida, o handler re-escopa para o dono (`adoptInstallationOwner`).

---

## 3. Contexto transacional

### 3.1 Store do ator

Novo arquivo `src/shared/database/postgres/db-actor.ts`:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

export type ActorType = 'user' | 'auth' | 'service' | 'job' | 'anonymous';

export interface DbActor {
  userId: string | null;
  actorType: ActorType;
}

export const dbActorStorage = new AsyncLocalStorage<DbActor>();

export function currentDbActor(): DbActor {
  return dbActorStorage.getStore() ?? { userId: null, actorType: 'anonymous' };
}
```

### 3.2 Middleware abre o escopo

Middleware, não interceptor: interceptor não cobre bem SSE de vida longa, e o middleware do Express estabelece o escopo antes de toda a cadeia, com o ALS propagando por todo o encadeamento assíncrono.

Em `src/main.ts`, logo depois de `app.use(requestCredentials)`:

```ts
app.use((_req, _res, next) => {
  dbActorStorage.run({ userId: null, actorType: 'anonymous' }, () => next());
});
```

O objeto é mutável de propósito: o middleware roda antes do guard e ainda não sabe quem é o usuário.

### 3.3 Guard preenche o ator

Em `src/modules/auth/guards/jwt-access.guard.ts`, após validar o token:

```ts
const actor = dbActorStorage.getStore();
if (actor) {
  actor.userId = payload.sub;
  actor.actorType = 'user';
}
```

O id vem exclusivamente do payload verificado. Nunca de body, query ou header (SEC-16).

### 3.4 Unidade de trabalho

Novo arquivo `src/shared/database/postgres/rls.transaction.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { type ActorType, currentDbActor } from './db-actor';

@Injectable()
export class RlsTransaction {
  constructor(@Inject('DATA_SOURCE') private readonly datasource: DataSource) {}

  async run<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    const actor = currentDbActor();
    return this.runAs(actor.actorType, actor.userId, work);
  }

  async runAs<T>(
    actorType: ActorType,
    userId: string | null,
    work: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.datasource.transaction(async (manager) => {
      await manager.query(
        `SELECT set_config('app.user_id', $1, true),
                set_config('app.actor_type', $2, true)`,
        [userId ?? '', actorType],
      );
      return work(manager);
    });
  }
}
```

- Valores vão como parâmetro. Nunca interpolados.
- Os dois `set_config` num único `SELECT` custam uma ida ao banco.
- `datasource.transaction` garante conexão dedicada e transação aberta, então `is_local = true` tem o escopo correto e é seguro com pool.
- `runAs` é a porta explícita do `AuthService` (`'auth'`), dos webhooks (`'service'`) e dos workers (`'job'`).

### 3.5 Injeção automática no `DefaultRepository`

Propagar um `manager` por centenas de call sites seria uma reescrita enorme e uma fonte permanente de esquecimento — bastaria uma leitura solta ficar de fora para ela rodar sem contexto.

Em vez disso, o gargalo que já existia virou o ponto de injeção. `DefaultRepository.withRepository` (`src/shared/database/postgres/default.database.ts`):

- **com `manager`**: o chamador já abriu a transação e já injetou o contexto — respeitamos a unidade de trabalho dele;
- **sem `manager`**: abrimos uma transação curta só para aquela query e injetamos o ator do escopo assíncrono atual.

Resultado: cobertura completa, zero mudança nos call sites, e quem precisa de várias queries consistentes entre si continua podendo abrir a transação explícita.

Custo: um round trip extra de `set_config` por query solta. Aceitável, e explícito no código.

`createQueryBuilder` é a exceção — é construído e executado pelo chamador, então não dá para envolvê-lo. A assinatura passou a **exigir** o `manager`, e o typechecker apontou os quatro call sites que rodavam sem contexto:

```
src/modules/analyses/analyses.service.ts
src/modules/users/user.service.ts
src/modules/github-app/use-cases/handle-webhook/handle-webhook.use-case.ts
src/modules/github-app/use-cases/unlink-installation/unlink-installation.use-case.ts
```

Os 10 call sites que já abriam transação passaram de `datasource.transaction(...)` para `withRlsTransaction(...)` — mesma forma, agora com contexto.

### 3.6 SSE

Não envolver o stream. Envolver cada passo discreto: carregar a análise, persistir iteração, finalizar. Cada um no seu `rls.run`. `src/modules/analyses/analyses.service.ts` é o arquivo mais afetado.

### 3.7 Workers BullMQ

`src/modules/github-app/infrastructure/queue/review.processor.ts` e `src/modules/repositories/indexing/index.processor.ts` não carregam ator (SEC-17). O payload do job passa a ter `actorUserId`, e o processor abre o escopo:

```ts
await dbActorStorage.run(
  { userId: job.data.actorUserId, actorType: 'job' },
  () => this.handle(job),
);
```

Enfileirar sem `actorUserId` deve lançar, não assumir null.

---

## 4. Mudança de comportamento a planejar

Sob RLS, "não existe" e "não é seu" passam a ser indistinguíveis.

`DefaultRepository.update(id, data)` (`src/shared/database/postgres/default.database.ts:88`) filtra apenas por PK. Hoje é protegido por uma verificação anterior de dono. Sob RLS vira **no-op silencioso**: `UpdateResult.affected === 0` em vez de exceção. Todo caller que ignora o retorno passa a falhar sem avisar.

Antes de ligar RLS: auditar os callers de `.update()` e `.delete()` e passar a checar `affected`.

---

## 5. Rollout e verificação

Itens 2 e 4 já estão feitos. 1, 3 e 5 são operação.

1. Bootstrap das roles em banco descartável. Confirmar:
   ```sql
   SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname LIKE 'cast_%';
   ```
   Ambos precisam de `rolbypassrls = false` e `rolsuper = false`.
2. ~~Plumbing da seção 3 antes de qualquer `ENABLE`.~~ **Feito.** Enquanto `DB_USER` for o dono das tabelas, a policy `_maintenance` mantém o comportamento atual — o plumbing está inerte até o item 1 rodar.
3. Ligar tabela a tabela, do tráfego mais baixo para o mais alto: `architecture_*` → `feature_cards` → `benchmarks` → `chat` → `analyses` → `projects` → `github_app` → `users`. Cada etapa expõe plumbing faltando sem derrubar o produto inteiro.
4. ~~Teste SEC-19.~~ **Feito**, em `test/rls-isolation.e2e-spec.ts`: banco descartável, role de runtime criada sem `BYPASSRLS` e sem posse das tabelas, dois usuários, queries diretas sem passar pelo service layer.

   | Contexto | Ação sobre linha de B | Verificado |
   |---|---|---|
   | `app.user_id = A` | `SELECT` | 0 linhas |
   | `app.user_id = A` | `UPDATE` | 0 affected |
   | `app.user_id = A` | `DELETE` | 0 affected |
   | `app.user_id = A` | `INSERT` com dono B | erro de `WITH CHECK` |
   | `app.user_id = A` | `UPDATE` reatribuindo dono | erro de `WITH CHECK` |
   | `app.user_id = A` | filho via `thread_id` do pai de B | 0 linhas |
   | sem contexto | qualquer | 0 linhas |
   | `actor_type = 'service'` | `SELECT` em `projects` | 0 linhas |
   | `actor_type = 'job'` | `DELETE` em conta real | 0 affected |

5. Check de CI, falha fechada, pega tabela nova entrando sem policy:
   ```sql
   SELECT count(*) FROM pg_tables t
   JOIN pg_class c ON c.relname = t.tablename
   WHERE t.schemaname = 'public'
     AND t.tablename <> 'migrations'
     AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);
   ```
   Precisa retornar 0.

---

## O que falta

Só operação, nesta ordem:

1. Rodar `scripts/sql/00-roles.sql` no ambiente alvo.
2. Apontar `MIGRATION_DATABASE_URL` para `cast_migrator` e `DB_USER` para `cast_runtime`.
3. Rodar `scripts/sql/01-verify-roles.sql` e exigir zero linhas em todas as quatro checagens.
4. Colocar essa verificação como check obrigatório no CI.

Enquanto o passo 2 não acontecer, a RLS está ligada mas o runtime conecta como dono e a policy `_maintenance` o libera. É rollout gradual de propósito — não é o estado final.
