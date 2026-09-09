import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { sign } from 'jsonwebtoken';
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

const PASSWORD = 'correct-horse-bat';
const ACCESS_SECRET = 'access-secret-for-e2e-only-0000000000';
const REFRESH_SECRET = 'refresh-secret-for-e2e-only-000000000';

describe('What an intercepted token buys an attacker', () => {
  const database = `cast_intercept_test_${randomUUID().replaceAll('-', '')}`;
  const userId = randomUUID();
  const victimEmail = `${userId}@test.invalid`;
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

  async function login() {
    return post('/auth/login')
      .send({ email: victimEmail, password: PASSWORD })
      .expect(200);
  }

  const protectedGet = (token: string) =>
    request(app.getHttpServer())
      .get(`/users/${userId}`)
      .set('Authorization', `Bearer ${token}`);

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.FRONTEND_ORIGINS = 'http://localhost:5173';
    process.env.JWT_ACCESS_SECRET = ACCESS_SECRET;
    process.env.JWT_REFRESH_SECRET = REFRESH_SECRET;
    process.env.JWT_ACCESS_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';
    delete process.env.CREDENTIALS_MODE;

    const base = configured.options as PostgresConnectionOptions;
    admin = new DataSource({ ...base, migrations: [], entities: [] });
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    db = new DataSource({ ...base, database });
    await db.initialize();
    await db.runMigrations();
    await db.query(
      `INSERT INTO users (id, name, email, username, password) VALUES ($1, 'Victim', $2, $3, $4)`,
      [
        userId,
        victimEmail,
        `user${userId.slice(0, 8)}`,
        await bcrypt.hash(PASSWORD, 4),
      ],
    );

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
    await db.query('UPDATE users SET active = true WHERE id = $1', [userId]);
  });

  describe('forging a token without the secret', () => {
    it('rejects a token signed with an attacker secret', async () => {
      const forged = sign({ sub: userId }, 'attacker-secret', {
        expiresIn: '15m',
      });

      await protectedGet(forged).expect(401);
    });

    it('rejects an alg:none token', async () => {
      const header = Buffer.from(
        JSON.stringify({ alg: 'none', typ: 'JWT' }),
      ).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 900 }),
      ).toString('base64url');

      await protectedGet(`${header}.${payload}.`).expect(401);
    });

    it('rejects a token whose payload was swapped after signing', async () => {
      const genuine = sign({ sub: userId }, ACCESS_SECRET, { expiresIn: '15m' });
      const [head, , signature] = genuine.split('.');
      const swapped = Buffer.from(
        JSON.stringify({ sub: randomUUID() }),
      ).toString('base64url');

      await protectedGet(`${head}.${swapped}.${signature}`).expect(401);
    });

    it('rejects a token with a valid shape but no signature', async () => {
      const genuine = sign({ sub: userId }, ACCESS_SECRET, { expiresIn: '15m' });
      const [head, payload] = genuine.split('.');

      await protectedGet(`${head}.${payload}.`).expect(401);
    });
  });

  describe('using a token where it does not belong', () => {
    it('refuses a refresh token presented as an access token', async () => {
      const cookie = cookieOf(await login());
      const refreshToken = cookie.slice('cast_refresh='.length);

      await protectedGet(refreshToken).expect(401);
    });

    it('refuses an access token presented as the refresh cookie', async () => {
      const { body } = await login();

      await post('/auth/refresh')
        .set('Cookie', `cast_refresh=${body.accessToken}`)
        .expect(401);
    });

    it('refuses an access token signed with the refresh secret', async () => {
      const crossSigned = sign({ sub: userId }, REFRESH_SECRET, {
        expiresIn: '15m',
      });

      await protectedGet(crossSigned).expect(401);
    });
  });

  describe('an access token that really was intercepted', () => {
    it('works until it expires — that is the exposure window', async () => {
      const { body } = await login();

      await protectedGet(body.accessToken).expect(200);
    });

    it('cannot mint a new session without the refresh cookie', async () => {
      const { body } = await login();

      await post('/auth/refresh')
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(401);
    });

    it('stops working the moment the account is deactivated', async () => {
      const { body } = await login();
      await protectedGet(body.accessToken).expect(200);

      await db.query('UPDATE users SET active = false WHERE id = $1', [userId]);

      await protectedGet(body.accessToken).expect(401);
    });

    it('is refused once it has expired', async () => {
      const expired = sign({ sub: userId }, ACCESS_SECRET, { expiresIn: '-1s' });

      await protectedGet(expired).expect(401);
    });

    it('cannot reach another user through the id in the URL', async () => {
      const otherId = randomUUID();
      await db.query(
        `INSERT INTO users (id, name, email, username, password) VALUES ($1, 'Other', $2, $3, 'x')`,
        [otherId, `${otherId}@test.invalid`, `user${otherId.slice(0, 8)}`],
      );
      const { body } = await login();

      await request(app.getHttpServer())
        .get(`/users/${otherId}`)
        .set('Authorization', `Bearer ${body.accessToken}`)
        .expect(403);

      await db.query('DELETE FROM users WHERE id = $1', [otherId]);
    });
  });

  describe('a refresh cookie that really was intercepted', () => {
    it('lets the attacker in once, then the victim trips the alarm and kills both', async () => {
      const stolen = cookieOf(await login());

      const attacker = await post('/auth/refresh')
        .set('Cookie', stolen)
        .expect(200);
      const attackerCookie = cookieOf(attacker);

      await post('/auth/refresh').set('Cookie', stolen).expect(401);

      await post('/auth/refresh').set('Cookie', attackerCookie).expect(401);

      const rows = (await db.query(
        `SELECT revoked_at, revoked_reason FROM refresh_sessions`,
      )) as Array<{ revoked_at: Date | null; revoked_reason: string | null }>;

      expect(rows.every((row) => row.revoked_at !== null)).toBe(true);
      expect(rows.some((row) => row.revoked_reason === 'reuse_detected')).toBe(
        true,
      );
    });

    it('is useless from a foreign origin even while still valid', async () => {
      const stolen = cookieOf(await login());

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Origin', 'https://attacker.test')
        .set('X-Cast-CSRF', '1')
        .set('Cookie', stolen)
        .expect(403);

      await post('/auth/refresh').set('Cookie', stolen).expect(200);
    });

    it('is useless from a cross-site form post with no custom header', async () => {
      const stolen = cookieOf(await login());

      await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Origin', 'http://localhost:5173')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .set('Cookie', stolen)
        .expect(403);
    });
  });

  describe('the response never hands a credential back', () => {
    it('does not echo the session credential headers', async () => {
      const { body } = await login();

      const response = await request(app.getHttpServer())
        .get(`/users/${userId}`)
        .set('Authorization', `Bearer ${body.accessToken}`)
        .set('X-Cast-Openai-Key', 'sk-session-only-key')
        .set('X-Cast-Github-Token', 'ghp_session_only_token')
        .expect(200);

      const serialized = JSON.stringify({
        headers: response.headers,
        body: response.body,
      });

      expect(serialized).not.toContain('sk-session-only-key');
      expect(serialized).not.toContain('ghp_session_only_token');
    });

    it('does not persist a session credential that only passed through', async () => {
      const { body } = await login();

      await request(app.getHttpServer())
        .get(`/users/${userId}`)
        .set('Authorization', `Bearer ${body.accessToken}`)
        .set('X-Cast-Openai-Key', 'sk-session-only-key')
        .expect(200);

      const rows = (await db.query(
        `SELECT openai_key, github_token FROM users WHERE id = $1`,
        [userId],
      )) as Array<{ openai_key: string | null; github_token: string | null }>;

      expect(rows[0].openai_key).toBeNull();
      expect(rows[0].github_token).toBeNull();
    });

    it('never returns the access token in a redirect or Location header', async () => {
      const response = await login();

      expect(response.headers.location).toBeUndefined();
      expect(JSON.stringify(response.headers)).not.toContain(
        response.body.accessToken,
      );
    });

    it('marks every authenticated response as uncacheable', async () => {
      const { body } = await login();

      const response = await protectedGet(body.accessToken).expect(200);

      expect(response.headers['cache-control']).toBe('no-store');
    });
  });
});
