import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { AuthController } from 'src/modules/auth/auth.controller';
import { AuthService } from 'src/modules/auth/auth.service';
import { JwtAccessGuard } from 'src/modules/auth/guards/jwt-access.guard';
import { JwtRefreshGuard } from 'src/modules/auth/guards/jwt-refresh.guard';
import { RefreshSessionRepository } from 'src/modules/auth/refresh-session.repository';
import { UserController } from 'src/modules/users/user.controller';
import { UserRepository } from 'src/modules/users/user.repository';
import { UserService } from 'src/modules/users/user.service';
import configured from 'src/shared/database/postgres/postgres.datasource';
import { AppLogger } from 'src/shared/logger/logger.service';
import { httpSecurity } from 'src/shared/security/http-security';
import { requestCredentials } from 'src/shared/security/request-credentials';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

describe('Guest access from the login screen', () => {
  const database = `cast_demo_test_${randomUUID().replaceAll('-', '')}`;
  const environment = { ...process.env };
  let admin: DataSource;
  let db: DataSource;
  let app: INestApplication;
  let created = false;

  const post = (path: string) =>
    request(app.getHttpServer())
      .post(path)
      .set('Origin', 'http://localhost:5173')
      .set('X-Cast-CSRF', '1');

  function cookieOf(response: request.Response): string {
    const header = response.headers['set-cookie'] as unknown as string[];
    const cookie = header?.find((value) => value.startsWith('cast_refresh='));
    if (!cookie) throw new Error('refresh cookie ausente');
    return cookie.split(';')[0];
  }

  async function guests(): Promise<
    Array<{ id: string; email: string; demo_expires_at: Date | null }>
  > {
    return db.query(
      `SELECT id, email, demo_expires_at FROM users WHERE demo_expires_at IS NOT NULL ORDER BY created_at ASC`,
    );
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.FRONTEND_ORIGINS = 'http://localhost:5173';
    process.env.JWT_ACCESS_SECRET = 'access-secret-for-e2e-only-0000000000';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret-for-e2e-only-000000000';
    process.env.JWT_ACCESS_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    process.env.SECRET_ENCRYPTION_KEY = '01'.repeat(32);

    const base = configured.options as PostgresConnectionOptions;
    admin = new DataSource({ ...base, migrations: [], entities: [] });
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    db = new DataSource({ ...base, database });
    await db.initialize();
    await db.runMigrations();

    const module = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      controllers: [AuthController, UserController],
      providers: [
        AuthService,
        UserService,
        UserRepository,
        RefreshSessionRepository,
        JwtRefreshGuard,
        { provide: APP_GUARD, useClass: JwtAccessGuard },
        { provide: 'DATA_SOURCE', useValue: db },
        {
          provide: AppLogger,
          useValue: { error: jest.fn(), log: jest.fn(), warn: jest.fn() },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.use(httpSecurity);
    app.use(requestCredentials);
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  }, 60000);

  afterAll(async () => {
    await app?.close();
    if (db?.isInitialized) await db.destroy();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    if (admin?.isInitialized) await admin.destroy();
    process.env = { ...environment };
  });

  beforeEach(async () => {
    await db.query('DELETE FROM refresh_sessions');
    await db.query('DELETE FROM analyses');
    await db.query('DELETE FROM users');
    process.env.DEMO_LOGIN = 'true';
    delete process.env.DEMO_SESSION_TTL_MINUTES;
    delete process.env.CREDENTIALS_MODE;
  });

  describe('when the demo access is off', () => {
    it('refuses to hand out a guest session', async () => {
      delete process.env.DEMO_LOGIN;

      await post('/auth/demo').expect(403);
      expect(await guests()).toHaveLength(0);
    });

    it('is off by default, not on', async () => {
      process.env.DEMO_LOGIN = 'maybe';

      await post('/auth/demo').expect(403);
    });
  });

  describe('when the demo access is on', () => {
    it('hands out a real session without any credential', async () => {
      const response = await post('/auth/demo').expect(200);

      expect(Object.keys(response.body)).toEqual(['accessToken']);
      expect(cookieOf(response)).toMatch(/^cast_refresh=/);
    });

    it('creates one throwaway user per click, each with an expiry', async () => {
      await post('/auth/demo').expect(200);
      await post('/auth/demo').expect(200);

      const rows = await guests();
      expect(rows).toHaveLength(2);
      expect(rows[0].id).not.toBe(rows[1].id);
      for (const row of rows) {
        expect(row.demo_expires_at).not.toBeNull();
        expect(row.email).toMatch(/^guest-.+@demo\.invalid$/);
      }
    });

    it('honours the configured session length', async () => {
      process.env.DEMO_SESSION_TTL_MINUTES = '15';
      const before = Date.now();

      await post('/auth/demo').expect(200);

      const [row] = await guests();
      const ttl = new Date(row.demo_expires_at as Date).getTime() - before;
      expect(ttl).toBeGreaterThan(14 * 60 * 1000);
      expect(ttl).toBeLessThan(16 * 60 * 1000);
    });

    it('lets the guest use the app like any other user', async () => {
      const { body } = await post('/auth/demo').expect(200);
      const [row] = await guests();

      const profile = await request(app.getHttpServer())
        .get(`/users/${row.id}`)
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(200);

      expect(profile.body.isGuest).toBe(true);
      expect(profile.body.guestExpiresAt).toBeTruthy();
      expect(profile.body.name).toBe('Visitante');
    });

    it('keeps the guest session refreshable', async () => {
      const first = await post('/auth/demo').expect(200);

      await post('/auth/refresh').set('Cookie', cookieOf(first)).expect(200);
    });

    it('does not let one guest read another guest', async () => {
      const first = await post('/auth/demo').expect(200);
      await post('/auth/demo').expect(200);
      const rows = await guests();
      const otherId = rows[1].id;

      await request(app.getHttpServer())
        .get(`/users/${otherId}`)
        .set('Authorization', `Bearer ${first.body.accessToken}`)
        .expect(403);
    });
  });

  describe('a guest never leaves a credential behind', () => {
    it('refuses to persist an OpenAI key even when the instance stores them', async () => {
      process.env.CREDENTIALS_MODE = 'stored';
      const { body } = await post('/auth/demo').expect(200);
      const [row] = await guests();

      const response = await request(app.getHttpServer())
        .patch(`/users/${row.id}`)
        .set('Origin', 'http://localhost:5173')
        .set('X-Cast-CSRF', '1')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .send({ openaiKey: 'sk-guest-should-not-persist' })
        .expect(400);

      expect(response.body.message).toMatch(/Contas de teste/);

      const [stored] = (await db.query(
        `SELECT openai_key FROM users WHERE id = $1`,
        [row.id],
      )) as Array<{ openai_key: string | null }>;
      expect(stored.openai_key).toBeNull();
    });

    it('refuses to persist a GitHub token', async () => {
      process.env.CREDENTIALS_MODE = 'stored';
      const { body } = await post('/auth/demo').expect(200);
      const [row] = await guests();

      await request(app.getHttpServer())
        .patch(`/users/${row.id}`)
        .set('Origin', 'http://localhost:5173')
        .set('X-Cast-CSRF', '1')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .send({ githubToken: 'ghp_guest_should_not_persist' })
        .expect(400);
    });

    it('still lets the guest edit its own profile', async () => {
      const { body } = await post('/auth/demo').expect(200);
      const [row] = await guests();

      await request(app.getHttpServer())
        .patch(`/users/${row.id}`)
        .set('Origin', 'http://localhost:5173')
        .set('X-Cast-CSRF', '1')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .send({ name: 'Visitante renomeado' })
        .expect(200);
    });
  });

  describe('expiry', () => {
    it('sweeps expired guests on the next visit and takes their data along', async () => {
      await post('/auth/demo').expect(200);
      const [stale] = await guests();

      await db.query(
        `INSERT INTO analyses (id, requested_by, owner, repo, pull_number, status, report, thoughts, models)
         VALUES ($1, $2, 'owner', 'repo', 1, 'completed', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb)`,
        [randomUUID(), stale.id],
      );
      await db.query(
        `UPDATE users SET demo_expires_at = now() - interval '1 hour' WHERE id = $1`,
        [stale.id],
      );

      await post('/auth/demo').expect(200);

      const remaining = (await db.query(`SELECT id FROM users WHERE id = $1`, [
        stale.id,
      ])) as unknown[];
      const orphans = (await db.query(
        `SELECT id FROM analyses WHERE requested_by = $1`,
        [stale.id],
      )) as unknown[];

      expect(remaining).toHaveLength(0);
      expect(orphans).toHaveLength(0);
    });

    it('leaves a guest that has not expired alone', async () => {
      await post('/auth/demo').expect(200);
      const [alive] = await guests();

      await post('/auth/demo').expect(200);

      const remaining = (await db.query(`SELECT id FROM users WHERE id = $1`, [
        alive.id,
      ])) as unknown[];
      expect(remaining).toHaveLength(1);
    });

    it('never touches a real account while sweeping', async () => {
      const realId = randomUUID();
      await db.query(
        `INSERT INTO users (id, name, email, password) VALUES ($1, 'Real', $2, 'hash')`,
        [realId, `${realId}@cast.test`],
      );

      await post('/auth/demo').expect(200);

      const remaining = (await db.query(`SELECT id FROM users WHERE id = $1`, [
        realId,
      ])) as unknown[];
      expect(remaining).toHaveLength(1);
    });
  });

  describe('the demo route is not a soft spot', () => {
    it('rejects a call from a foreign origin', async () => {
      await request(app.getHttpServer())
        .post('/auth/demo')
        .set('Origin', 'https://attacker.test')
        .set('X-Cast-CSRF', '1')
        .expect(403);
    });

    it('rejects a cross-site form post with no custom header', async () => {
      await request(app.getHttpServer())
        .post('/auth/demo')
        .set('Origin', 'http://localhost:5173')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .expect(403);
    });

    it('does not accept a password for the generated guest account', async () => {
      await post('/auth/demo').expect(200);
      const [row] = await guests();

      await post('/auth/login')
        .send({ email: row.email, password: 'senha-qualquer-1' })
        .expect(401);
    });
  });
});
