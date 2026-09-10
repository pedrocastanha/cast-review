import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * RLS como segunda barreira contra IDOR (SEC-14 a SEC-19).
 *
 * O isolamento na camada de aplicação continua sendo o principal; isto existe
 * para que uma regressão de autorização no service layer não vire vazamento de
 * dado. Sob RLS, "não é seu" e "não existe" passam a ser a mesma resposta.
 *
 * Pré-requisito: `scripts/sql/00-roles.sql` já executado, com `cast_runtime`
 * separada do dono das tabelas. Sem isso, `FORCE ROW LEVEL SECURITY` é o que
 * impede que apontar `DB_USER` para o dono desligue silenciosamente as policies.
 */

/** Tabelas cuja própria linha carrega o dono. */
const OWNED_TABLES: Array<[table: string, ownerColumn: string]> = [
  ['users', 'id'],
  ['projects', 'owner_id'],
  ['analyses', 'requested_by'],
  ['finding_cases', 'requested_by'],
  ['architecture_maps', 'owner_id'],
  ['chat_threads', 'user_id'],
  ['benchmark_runs', 'requested_by'],
  ['github_installations', 'owner_user_id'],
];

/** Tabelas que herdam o dono de um pai por chave estrangeira. */
const DERIVED_TABLES: Array<
  [table: string, fk: string, parent: string, parentOwnerColumn: string]
> = [
  ['chat_messages', 'thread_id', 'chat_threads', 'user_id'],
  ['analysis_context_snapshots', 'analysis_id', 'analyses', 'requested_by'],
  ['finding_occurrences', 'case_id', 'finding_cases', 'requested_by'],
  ['finding_case_events', 'case_id', 'finding_cases', 'requested_by'],
  ['architecture_capabilities', 'map_id', 'architecture_maps', 'owner_id'],
  ['architecture_components', 'map_id', 'architecture_maps', 'owner_id'],
  ['architecture_boundaries', 'map_id', 'architecture_maps', 'owner_id'],
  ['architecture_map_versions', 'map_id', 'architecture_maps', 'owner_id'],
  ['project_repositories', 'project_id', 'projects', 'owner_id'],
  ['feature_cards', 'project_id', 'projects', 'owner_id'],
  [
    'github_app_repositories',
    'installation_id',
    'github_installations',
    'owner_user_id',
  ],
  [
    'github_review_runs',
    'installation_id',
    'github_installations',
    'owner_user_id',
  ],
];

/**
 * Tabelas sem dono acessível pelo runtime. RLS ligada e nenhuma policy
 * permissiva: negam tudo. `posts` é resíduo do template Nest, sem entity e sem
 * uso no código — se algum dia voltar a ser usada, precisa de policy própria.
 */
const DENIED_TABLES = ['posts'];

const ALL_TABLES = [
  ...OWNED_TABLES.map(([table]) => table),
  ...DERIVED_TABLES.map(([table]) => table),
  ...DENIED_TABLES,
  'feature_card_revisions',
  'benchmark_cases',
  'refresh_sessions',
  'github_webhook_deliveries',
];

async function tableExists(
  queryRunner: QueryRunner,
  table: string,
): Promise<boolean> {
  const [row] = (await queryRunner.query(
    `SELECT to_regclass($1) IS NOT NULL AS present`,
    [`public.${table}`],
  )) as Array<{ present: boolean }>;
  return row?.present === true;
}

export class EnableRowLevelSecurity1789000000000 implements MigrationInterface {
  name = 'EnableRowLevelSecurity1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS app`);

    // STABLE, nunca IMMUTABLE: IMMUTABLE permite ao planner cachear o valor
    // entre transações, o que vaza a linha de um usuário para outro.
    // O `true` em current_setting devolve NULL quando a variável não foi setada,
    // e NULL nunca satisfaz uma comparação — o default é negar (SEC-14).
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
      LANGUAGE sql STABLE PARALLEL SAFE AS $$
        SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
      $$
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION app.actor_type() RETURNS text
      LANGUAGE sql STABLE PARALLEL SAFE AS $$
        SELECT COALESCE(NULLIF(current_setting('app.actor_type', true), ''), 'anonymous')
      $$
    `);

    // `posts` é resíduo do template Nest: existe em bancos antigos, não é criada
    // por nenhuma migration. Ligar RLS só no que existe mantém a migration
    // idempotente entre ambientes.
    const present: string[] = [];
    for (const table of ALL_TABLES) {
      if (await tableExists(queryRunner, table)) present.push(table);
    }

    for (const table of present) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`,
      );
      // Sob FORCE, o dono também é filtrado. Data migrations precisam de DML
      // cross-user, então quem está rodando a migration recebe uma policy
      // permissiva nomeada. Em produção isso é `cast_migrator`; em dev, a role
      // única do bootstrap. Policies são permissivas e combinadas por OR.
      await queryRunner.query(`
        DO $$
        BEGIN
          EXECUTE format(
            'CREATE POLICY %I ON %I TO %I USING (true) WITH CHECK (true)',
            '${table}_maintenance', '${table}', current_user
          );
        END
        $$
      `);
    }

    for (const [table, ownerColumn] of OWNED_TABLES) {
      if (!present.includes(table)) continue;
      // WITH CHECK não é opcional: sem ele o usuário insere linha com dono
      // alheio e reatribui o dono para fora do próprio escopo em UPDATE.
      await queryRunner.query(`
        CREATE POLICY "${table}_owner" ON "${table}"
          FOR ALL
          USING ("${ownerColumn}" = app.current_user_id())
          WITH CHECK ("${ownerColumn}" = app.current_user_id())
      `);
    }

    for (const [table, fk, parent, parentOwner] of DERIVED_TABLES) {
      if (!present.includes(table)) continue;
      const predicate = `EXISTS (
        SELECT 1 FROM "${parent}" p
        WHERE p.id = "${table}"."${fk}"
          AND p."${parentOwner}" = app.current_user_id()
      )`;
      await queryRunner.query(`
        CREATE POLICY "${table}_owner" ON "${table}"
          FOR ALL
          USING (${predicate})
          WITH CHECK (${predicate})
      `);
    }

    // Dois saltos: revisão -> card -> projeto.
    const revisionPredicate = `EXISTS (
      SELECT 1 FROM "feature_cards" c
      JOIN "projects" p ON p.id = c.project_id
      WHERE c.id = "feature_card_revisions"."card_id"
        AND p.owner_id = app.current_user_id()
    )`;
    await queryRunner.query(`
      CREATE POLICY "feature_card_revisions_owner" ON "feature_card_revisions"
        FOR ALL
        USING (${revisionPredicate})
        WITH CHECK (${revisionPredicate})
    `);

    // Catálogo curated é leitura pública autenticada; casos privados são do dono.
    await queryRunner.query(`
      CREATE POLICY "benchmark_cases_read" ON "benchmark_cases"
        FOR SELECT
        USING (kind = 'curated' OR owner_id = app.current_user_id())
    `);
    await queryRunner.query(`
      CREATE POLICY "benchmark_cases_write" ON "benchmark_cases"
        FOR ALL
        USING (kind = 'private' AND owner_id = app.current_user_id())
        WITH CHECK (kind = 'private' AND owner_id = app.current_user_id())
    `);

    // Bootstrap de autenticação. `refresh_sessions` é consultada por token_hash
    // ANTES de existir usuário autenticado; uma policy só por user_id mataria o
    // refresh. `actor_type = 'auth'` é setado exclusivamente dentro do
    // AuthService, em queries nomeadas — buraco deliberado e auditável.
    await queryRunner.query(`
      CREATE POLICY "refresh_sessions_scope" ON "refresh_sessions"
        FOR ALL
        USING (app.actor_type() = 'auth' OR user_id = app.current_user_id())
        WITH CHECK (app.actor_type() = 'auth' OR user_id = app.current_user_id())
    `);
    // Login por e-mail devolve, por definição, a linha de quem ainda não se
    // autenticou. Só SELECT, só sob actor_type 'auth'.
    await queryRunner.query(`
      CREATE POLICY "users_auth_bootstrap" ON "users"
        FOR SELECT
        USING (app.actor_type() = 'auth')
    `);

    // O webhook precisa achar a instalação pelo `installation_id` do payload
    // ANTES de saber de quem ela é — mesmo problema de bootstrap do login.
    // Só SELECT, e o handler re-escopa para o dono assim que o resolve.
    await queryRunner.query(`
      CREATE POLICY "github_installations_service_bootstrap" ON "github_installations"
        FOR SELECT
        USING (app.actor_type() = 'service')
    `);

    // Webhook do GitHub chega sem usuário.
    await queryRunner.query(`
      CREATE POLICY "github_webhook_deliveries_service" ON "github_webhook_deliveries"
        FOR ALL
        USING (app.actor_type() = 'service')
        WITH CHECK (app.actor_type() = 'service')
    `);

    // Expurgo de contas demo expiradas roda sem usuário dono. Alcança só linhas
    // de conta demo — nunca uma conta real.
    await queryRunner.query(`
      CREATE POLICY "users_demo_reaper" ON "users"
        FOR ALL
        USING (app.actor_type() = 'job' AND demo_expires_at IS NOT NULL)
        WITH CHECK (app.actor_type() = 'job' AND demo_expires_at IS NOT NULL)
    `);
    // O expurgo também apaga as análises da conta demo. A subquery em `users`
    // passa pela policy acima, então o alcance continua limitado a contas demo.
    await queryRunner.query(`
      CREATE POLICY "analyses_demo_reaper" ON "analyses"
        FOR ALL
        USING (
          app.actor_type() = 'job'
          AND EXISTS (
            SELECT 1 FROM "users" u
            WHERE u.id = "analyses".requested_by
              AND u.demo_expires_at IS NOT NULL
          )
        )
        WITH CHECK (false)
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cast_runtime') THEN
          GRANT SELECT, INSERT, UPDATE, DELETE
            ON ALL TABLES IN SCHEMA public TO cast_runtime;
          REVOKE ALL ON TABLE migrations FROM cast_runtime;
          GRANT USAGE ON SCHEMA app TO cast_runtime;
          EXECUTE format(
            'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public
               GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO cast_runtime',
            current_user
          );
        END IF;
      END
      $$
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const policies: Array<[string, string]> = [
      ...OWNED_TABLES.map(
        ([table]) => [table, `${table}_owner`] as [string, string],
      ),
      ...DERIVED_TABLES.map(
        ([table]) => [table, `${table}_owner`] as [string, string],
      ),
      ['feature_card_revisions', 'feature_card_revisions_owner'],
      ['benchmark_cases', 'benchmark_cases_read'],
      ['benchmark_cases', 'benchmark_cases_write'],
      ['refresh_sessions', 'refresh_sessions_scope'],
      ['users', 'users_auth_bootstrap'],
      ['users', 'users_demo_reaper'],
      ['analyses', 'analyses_demo_reaper'],
      ['github_webhook_deliveries', 'github_webhook_deliveries_service'],
      ['github_installations', 'github_installations_service_bootstrap'],
      ...ALL_TABLES.map(
        (table) => [table, `${table}_maintenance`] as [string, string],
      ),
    ];

    for (const [table, policy] of policies) {
      if (!(await tableExists(queryRunner, table))) continue;
      await queryRunner.query(
        `DROP POLICY IF EXISTS "${policy}" ON "${table}"`,
      );
    }

    for (const table of ALL_TABLES) {
      if (!(await tableExists(queryRunner, table))) continue;
      await queryRunner.query(
        `ALTER TABLE "${table}" NO FORCE ROW LEVEL SECURITY`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DISABLE ROW LEVEL SECURITY`,
      );
    }

    await queryRunner.query(`DROP FUNCTION IF EXISTS app.actor_type()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS app.current_user_id()`);
  }
}
