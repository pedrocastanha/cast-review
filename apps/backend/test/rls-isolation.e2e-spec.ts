import { randomUUID } from 'node:crypto';
import configured from 'src/shared/database/postgres/postgres.datasource';
import { DataSource } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

/**
 * SEC-19. Prova o isolamento com DUAS conexões e DOIS usuários, executando
 * queries diretas com a role de runtime — sem passar pelo service layer.
 *
 * O ponto é justamente não confiar na aplicação: se a autorização do service
 * regredir, é isto aqui que continua negando.
 */
describe('RLS isolation (SEC-19)', () => {
  const database = `cast_rls_test_${randomUUID().replaceAll('-', '')}`;
  const runtimeRole = `cast_runtime_test_${randomUUID().slice(0, 8)}`;
  const runtimePassword = 'rls-test-password';

  const alice = randomUUID();
  const bob = randomUUID();
  const aliceProject = randomUUID();
  const bobProject = randomUUID();
  const bobThread = randomUUID();
  const bobMessage = randomUUID();

  let admin: DataSource;
  let owner: DataSource;
  let runtime: DataSource;
  let created = false;

  async function asUser<T>(
    userId: string | null,
    work: (
      query: (sql: string, params?: unknown[]) => Promise<any>,
    ) => Promise<T>,
    actorType = 'user',
  ): Promise<T> {
    const runner = runtime.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(
        `SELECT set_config('app.user_id', $1, true),
                set_config('app.actor_type', $2, true)`,
        [userId ?? '', actorType],
      );
      return await work((sql, params) => runner.query(sql, params));
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  }

  beforeAll(async () => {
    const base = configured.options as PostgresConnectionOptions;
    admin = new DataSource({ ...base, migrations: [], entities: [] });
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;

    owner = new DataSource({ ...base, database });
    await owner.initialize();
    await owner.runMigrations();

    // Role de runtime: sem BYPASSRLS, sem SUPERUSER e — crucialmente — não dona
    // das tabelas. Dono ignora RLS por padrão; é o FORCE somado a isto que
    // fecha o buraco.
    await owner.query(
      `CREATE ROLE "${runtimeRole}" LOGIN PASSWORD '${runtimePassword}'
         NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await owner.query(`GRANT USAGE ON SCHEMA public TO "${runtimeRole}"`);
    await owner.query(`GRANT USAGE ON SCHEMA app TO "${runtimeRole}"`);
    await owner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${runtimeRole}"`,
    );

    for (const [id, name] of [
      [alice, 'Alice'],
      [bob, 'Bob'],
    ]) {
      await owner.query(
        `INSERT INTO users (id, name, email, password) VALUES ($1, $2, $3, 'x')`,
        [id, name, `${id}@test.invalid`],
      );
    }
    await owner.query(
      `INSERT INTO projects (id, owner_id, name) VALUES ($1, $2, 'Alice project')`,
      [aliceProject, alice],
    );
    await owner.query(
      `INSERT INTO projects (id, owner_id, name) VALUES ($1, $2, 'Bob project')`,
      [bobProject, bob],
    );
    await owner.query(
      `INSERT INTO chat_threads (id, user_id, project_id, scope_type, title, scope)
       VALUES ($1, $2, $3, 'project', 'Bob thread', $4)`,
      [
        bobThread,
        bob,
        bobProject,
        JSON.stringify({
          mode: 'project',
          projectId: bobProject,
          repositories: [],
        }),
      ],
    );
    await owner.query(
      `INSERT INTO chat_messages (id, thread_id, role, content)
       VALUES ($1, $2, 'user', 'segredo do Bob')`,
      [bobMessage, bobThread],
    );

    runtime = new DataSource({
      ...base,
      database,
      username: runtimeRole,
      password: runtimePassword,
    });
    await runtime.initialize();
  }, 60_000);

  afterAll(async () => {
    if (runtime?.isInitialized) await runtime.destroy();
    if (owner?.isInitialized) {
      await owner.query(
        `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "${runtimeRole}"`,
      );
      await owner.query(`REVOKE USAGE ON SCHEMA public FROM "${runtimeRole}"`);
      await owner.query(`REVOKE USAGE ON SCHEMA app FROM "${runtimeRole}"`);
      await owner.destroy();
    }
    if (created) {
      await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await admin.query(`DROP ROLE IF EXISTS "${runtimeRole}"`);
    }
    if (admin?.isInitialized) await admin.destroy();
  }, 60_000);

  it('the runtime role can neither bypass RLS nor own the tables', async () => {
    const [role] = await owner.query(
      `SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = $1`,
      [runtimeRole],
    );
    expect(role.rolbypassrls).toBe(false);
    expect(role.rolsuper).toBe(false);

    const owned = await owner.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tableowner = $1`,
      [runtimeRole],
    );
    expect(owned).toEqual([]);
  });

  it('every business table has RLS enabled and forced', async () => {
    const offenders = await owner.query(`
      SELECT t.tablename
      FROM pg_tables t
      JOIN pg_class c ON c.relname = t.tablename
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.schemaname
      WHERE t.schemaname = 'public'
        AND t.tablename <> 'migrations'
        AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
    `);
    expect(offenders).toEqual([]);
  });

  it('sees only its own rows on select', async () => {
    const rows = await asUser(alice, (q) =>
      q(`SELECT id, name FROM projects ORDER BY name`),
    );
    expect(rows.map((row: { id: string }) => row.id)).toEqual([aliceProject]);
  });

  it('reads nothing at all without a context', async () => {
    const rows = await asUser(
      null,
      (q) => q(`SELECT id FROM projects`),
      'anonymous',
    );
    expect(rows).toEqual([]);
  });

  it('cannot read another user row by guessing its id', async () => {
    const rows = await asUser(alice, (q) =>
      q(`SELECT id FROM projects WHERE id = $1`, [bobProject]),
    );
    expect(rows).toEqual([]);
  });

  it('cannot update another user row', async () => {
    const result = await asUser(alice, (q) =>
      q(`UPDATE projects SET name = 'roubado' WHERE id = $1`, [bobProject]),
    );
    // TypeORM devolve [rows, affected] em UPDATE/DELETE.
    expect(result[1]).toBe(0);
  });

  it('cannot delete another user row', async () => {
    const result = await asUser(alice, (q) =>
      q(`DELETE FROM projects WHERE id = $1`, [bobProject]),
    );
    expect(result[1]).toBe(0);
  });

  it('cannot insert a row owned by someone else', async () => {
    await expect(
      asUser(alice, (q) =>
        q(
          `INSERT INTO projects (id, owner_id, name) VALUES ($1, $2, 'forjado')`,
          [randomUUID(), bob],
        ),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cannot reassign ownership of its own row to another user', async () => {
    await expect(
      asUser(alice, (q) =>
        q(`UPDATE projects SET owner_id = $1 WHERE id = $2`, [
          bob,
          aliceProject,
        ]),
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('cannot reach a child row through its parent, even knowing both ids', async () => {
    const rows = await asUser(alice, (q) =>
      q(`SELECT id, content FROM chat_messages WHERE thread_id = $1`, [
        bobThread,
      ]),
    );
    expect(rows).toEqual([]);
  });

  it('lets the owner reach their own child rows', async () => {
    const rows = await asUser(bob, (q) =>
      q(`SELECT id FROM chat_messages WHERE thread_id = $1`, [bobThread]),
    );
    expect(rows.map((row: { id: string }) => row.id)).toEqual([bobMessage]);
  });

  it('shows a user only their own users row', async () => {
    const rows = await asUser(alice, (q) =>
      q(`SELECT id FROM users ORDER BY id`),
    );
    expect(rows.map((row: { id: string }) => row.id)).toEqual([alice]);
  });

  it('opens the users table to the auth bootstrap for reads only', async () => {
    const readable = await asUser(
      null,
      (q) => q(`SELECT id FROM users`),
      'auth',
    );
    expect(readable.length).toBe(2);

    await expect(
      asUser(
        null,
        (q) => q(`UPDATE users SET name = 'x' WHERE id = $1`, [bob]),
        'auth',
      ),
    ).resolves.toEqual(expect.arrayContaining([expect.anything(), 0]));
  });

  it('lets the webhook find an installation but never business data', async () => {
    const installationRow = randomUUID();
    await owner.query(
      `INSERT INTO github_installations
         (id, installation_id, account_login, account_type, owner_user_id, status)
       VALUES ($1, '4242', 'acme', 'Organization', $2, 'active')`,
      [installationRow, bob],
    );

    const found = await asUser(
      null,
      (q) =>
        q(`SELECT id FROM github_installations WHERE installation_id = '4242'`),
      'service',
    );
    expect(found).toHaveLength(1);

    // O bootstrap de webhook é só leitura de instalação. Nada de negócio.
    const leaked = await asUser(
      null,
      (q) => q(`SELECT id FROM projects`),
      'service',
    );
    expect(leaked).toEqual([]);

    await owner.query(`DELETE FROM github_installations WHERE id = $1`, [
      installationRow,
    ]);
  });

  it('lets the demo reaper touch guest accounts only', async () => {
    const guest = randomUUID();
    await owner.query(
      `INSERT INTO users (id, name, email, password, demo_expires_at)
       VALUES ($1, 'Guest', $2, 'x', now() - interval '1 hour')`,
      [guest, `${guest}@test.invalid`],
    );

    const visible = await asUser(null, (q) => q(`SELECT id FROM users`), 'job');
    expect(visible.map((row: { id: string }) => row.id)).toEqual([guest]);

    // Conta real não pode ser alcançada pelo expurgo.
    const untouched = await asUser(
      null,
      (q) => q(`DELETE FROM users WHERE id = $1`, [alice]),
      'job',
    );
    expect(untouched[1]).toBe(0);

    const removed = await asUser(
      null,
      (q) => q(`DELETE FROM users WHERE id = $1`, [guest]),
      'job',
    );
    expect(removed[1]).toBe(1);
  });

  it('keeps refresh sessions readable by token hash before login', async () => {
    const sessionId = randomUUID();
    const familyId = randomUUID();
    await owner.query(
      `INSERT INTO refresh_sessions (id, user_id, family_id, token_hash, expires_at)
       VALUES ($1, $2, $3, 'hash-abc', now() + interval '7 days')`,
      [sessionId, bob, familyId],
    );

    // Sem usuário autenticado ainda: é exatamente o caso do refresh.
    const byHash = await asUser(
      null,
      (q) => q(`SELECT id FROM refresh_sessions WHERE token_hash = 'hash-abc'`),
      'auth',
    );
    expect(byHash).toHaveLength(1);

    // Um usuário autenticado não vê sessão de outro.
    const foreign = await asUser(alice, (q) =>
      q(`SELECT id FROM refresh_sessions WHERE token_hash = 'hash-abc'`),
    );
    expect(foreign).toEqual([]);

    await owner.query(`DELETE FROM refresh_sessions WHERE id = $1`, [
      sessionId,
    ]);
  });

  // --- Fluxos de autenticação --------------------------------------------
  // register/demo/login/refresh são rotas @Public(): o guard não roda e o ator
  // fica anônimo. Sob RLS, anônimo não lê nem escreve nada. Estes casos travam
  // o contrato mínimo que o bootstrap de autenticação precisa.

  it('refuses to create a user without an auth context', async () => {
    await expect(
      asUser(
        null,
        (q) =>
          q(
            `INSERT INTO users (id, name, email, password) VALUES ($1, 'X', $2, 'x')`,
            [randomUUID(), `${randomUUID()}@test.invalid`],
          ),
        'anonymous',
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it('lets the signup flow create a user under the auth context', async () => {
    const created = randomUUID();
    const rows = await asUser(
      null,
      async (q) => {
        await q(
          `INSERT INTO users (id, name, email, password) VALUES ($1, 'Novo', $2, 'x')`,
          [created, `${created}@test.invalid`],
        );
        return q(`SELECT id FROM users WHERE id = $1`, [created]);
      },
      'auth',
    );
    expect(rows).toHaveLength(1);
  });

  it('lets the refresh flow read the session owner by id', async () => {
    const rows = await asUser(
      null,
      (q) => q(`SELECT id, active FROM users WHERE id = $1`, [bob]),
      'auth',
    );
    expect(rows).toHaveLength(1);
  });

  it('does not let the auth context modify or delete an existing user', async () => {
    // O bootstrap precisa ler e criar. Alterar ou apagar conta alheia, não.
    const updated = await asUser(
      null,
      (q) => q(`UPDATE users SET name = 'sequestrado' WHERE id = $1`, [bob]),
      'auth',
    );
    expect(updated[1]).toBe(0);

    const deleted = await asUser(
      null,
      (q) => q(`DELETE FROM users WHERE id = $1`, [bob]),
      'auth',
    );
    expect(deleted[1]).toBe(0);
  });

  it('leaves no table with RLS enabled but no policy', async () => {
    const orphans = await owner.query(`
      SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
      WHERE c.relkind = 'r'
        AND c.relrowsecurity
        AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)
    `);
    expect(orphans).toEqual([]);
  });
});
