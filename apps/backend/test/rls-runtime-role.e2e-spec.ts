import { randomUUID } from 'node:crypto';
import configured from '../src/shared/database/postgres/postgres.datasource';
import { runInRlsTransaction } from '../src/shared/database/postgres/rls-context';
import { runWithDbActor } from '../src/shared/database/postgres/db-actor';
import { DataSource } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

/**
 * O teste que decide se a RLS pode ser ligada em produção.
 *
 * `rls-isolation.e2e-spec.ts` prova que as policies negam acesso cruzado. Este
 * prova o outro lado, que é o que derruba produção se estiver errado: com a
 * role de runtime REAL — sem BYPASSRLS e, crucialmente, NÃO dona das tabelas —
 * os caminhos legítimos da aplicação ainda funcionam.
 *
 * Enquanto `DB_USER` for o dono das tabelas, a policy `_maintenance` libera
 * tudo e nada disso é exercitado. É exatamente por isso que este teste cria uma
 * role separada em vez de reusar a conexão padrão.
 */
describe('RLS with a real runtime role', () => {
  const database = `cast_rls_rt_${randomUUID().replaceAll('-', '')}`;
  const runtimeRole = `cast_rt_${randomUUID().slice(0, 8)}`;
  const runtimePassword = 'rls-runtime-password';

  let admin: DataSource;
  let owner: DataSource;
  let runtime: DataSource;
  let created = false;

  beforeAll(async () => {
    const base = configured.options as PostgresConnectionOptions;
    admin = new DataSource({ ...base, migrations: [], entities: [] });
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;

    owner = new DataSource({ ...base, database });
    await owner.initialize();
    await owner.runMigrations();

    await owner.query(
      `CREATE ROLE "${runtimeRole}" LOGIN PASSWORD '${runtimePassword}'
         NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS`,
    );
    await owner.query(`GRANT USAGE ON SCHEMA public TO "${runtimeRole}"`);
    await owner.query(`GRANT USAGE ON SCHEMA app TO "${runtimeRole}"`);
    await owner.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${runtimeRole}"`,
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

  it('confirms the runtime role is not the table owner', async () => {
    const owned = await owner.query(
      `SELECT count(*)::int AS total FROM pg_tables
       WHERE schemaname = 'public' AND tableowner = $1`,
      [runtimeRole],
    );
    expect(owned[0].total).toBe(0);
  });

  it('runs the signup path: create a user with no authenticated actor', async () => {
    const id = randomUUID();

    await runInRlsTransaction(
      runtime,
      (manager) =>
        manager.query(
          `INSERT INTO users (id, name, email, password) VALUES ($1, 'Novo', $2, 'x')`,
          [id, `${id}@test.invalid`],
        ),
      { actorType: 'auth', userId: null },
    );

    const found = await runInRlsTransaction(
      runtime,
      (manager) => manager.query(`SELECT id FROM users WHERE id = $1`, [id]),
      { actorType: 'auth', userId: null },
    );
    expect(found).toHaveLength(1);
  });

  it('runs the login path: look a user up by email before any session exists', async () => {
    const id = randomUUID();
    const email = `${id}@test.invalid`;
    await owner.query(
      `INSERT INTO users (id, name, email, password) VALUES ($1, 'Login', $2, 'x')`,
      [id, email],
    );

    const rows = await runInRlsTransaction(
      runtime,
      (manager) =>
        manager.query(`SELECT id, password FROM users WHERE email = $1`, [email]),
      { actorType: 'auth', userId: null },
    );
    expect(rows).toHaveLength(1);
  });

  it('runs the refresh path: rotate a session and read its owner', async () => {
    const userId = randomUUID();
    const sessionId = randomUUID();
    const familyId = randomUUID();
    await owner.query(
      `INSERT INTO users (id, name, email, password) VALUES ($1, 'Refresh', $2, 'x')`,
      [userId, `${userId}@test.invalid`],
    );

    await runInRlsTransaction(
      runtime,
      async (manager) => {
        await manager.query(
          `INSERT INTO refresh_sessions (id, user_id, family_id, token_hash, expires_at)
           VALUES ($1, $2, $3, 'hash-rt', now() + interval '7 days')`,
          [sessionId, userId, familyId],
        );
        const consumed = await manager.query(
          `UPDATE refresh_sessions SET consumed_at = now()
           WHERE id = $1 AND consumed_at IS NULL`,
          [sessionId],
        );
        expect(consumed[1]).toBe(1);
        const user = await manager.query(
          `SELECT id, active FROM users WHERE id = $1`,
          [userId],
        );
        expect(user).toHaveLength(1);
      },
      { actorType: 'auth', userId: null },
    );
  });

  it('runs an authenticated write and read-back through the ambient actor', async () => {
    const userId = randomUUID();
    await owner.query(
      `INSERT INTO users (id, name, email, password) VALUES ($1, 'Dono', $2, 'x')`,
      [userId, `${userId}@test.invalid`],
    );

    const projectId = randomUUID();
    await runWithDbActor({ userId, actorType: 'user' }, async () => {
      await runInRlsTransaction(runtime, (manager) =>
        manager.query(
          `INSERT INTO projects (id, owner_id, name) VALUES ($1, $2, 'Meu')`,
          [projectId, userId],
        ),
      );

      const rows = await runInRlsTransaction(runtime, (manager) =>
        manager.query(`SELECT id FROM projects WHERE id = $1`, [projectId]),
      );
      expect(rows).toHaveLength(1);
    });
  });

  it('runs the worker path: act on behalf of a user via the job actor', async () => {
    const userId = randomUUID();
    await owner.query(
      `INSERT INTO users (id, name, email, password) VALUES ($1, 'Job', $2, 'x')`,
      [userId, `${userId}@test.invalid`],
    );
    const analysisId = randomUUID();

    await runWithDbActor({ userId, actorType: 'job' }, async () => {
      await runInRlsTransaction(runtime, (manager) =>
        manager.query(
          `INSERT INTO analyses (id, requested_by, owner, repo, pull_number, status)
           VALUES ($1, $2, 'acme', 'back', 1, 'queued')`,
          [analysisId, userId],
        ),
      );
    });

    const rows = await runWithDbActor({ userId, actorType: 'user' }, () =>
      runInRlsTransaction(runtime, (manager) =>
        manager.query(`SELECT id FROM analyses WHERE id = $1`, [analysisId]),
      ),
    );
    expect(rows).toHaveLength(1);
  });

  it('runs the webhook path: find an installation with no user context', async () => {
    const installationRow = randomUUID();
    await owner.query(
      `INSERT INTO github_installations
         (id, installation_id, account_login, account_type, status)
       VALUES ($1, '9191', 'acme', 'Organization', 'pending')`,
      [installationRow],
    );

    const rows = await runInRlsTransaction(
      runtime,
      (manager) =>
        manager.query(
          `SELECT id, owner_user_id FROM github_installations WHERE installation_id = '9191'`,
        ),
      { actorType: 'service', userId: null },
    );
    expect(rows).toHaveLength(1);
  });

  it('runs the demo reaper: delete an expired guest and its analyses', async () => {
    const guest = randomUUID();
    await owner.query(
      `INSERT INTO users (id, name, email, password, demo_expires_at)
       VALUES ($1, 'Guest', $2, 'x', now() - interval '1 hour')`,
      [guest, `${guest}@test.invalid`],
    );
    await owner.query(
      `INSERT INTO analyses (id, requested_by, owner, repo, pull_number, status)
       VALUES ($1, $2, 'acme', 'back', 2, 'queued')`,
      [randomUUID(), guest],
    );

    const removed = await runInRlsTransaction(
      runtime,
      async (manager) => {
        await manager.query(
          `DELETE FROM analyses WHERE requested_by = ANY($1::uuid[])`,
          [[guest]],
        );
        const result = await manager.query(
          `DELETE FROM users WHERE id = ANY($1::uuid[])`,
          [[guest]],
        );
        return result[1];
      },
      { actorType: 'job', userId: null },
    );
    expect(removed).toBe(1);
  });
});
