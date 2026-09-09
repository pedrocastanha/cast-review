import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { sign } from 'jsonwebtoken';
import { AuthController } from 'src/modules/auth/auth.controller';
import { AuthService } from 'src/modules/auth/auth.service';
import { JwtRefreshGuard } from 'src/modules/auth/guards/jwt-refresh.guard';
import { RefreshSessionRepository } from 'src/modules/auth/refresh-session.repository';
import { UserRepository } from 'src/modules/users/user.repository';
import { UserService } from 'src/modules/users/user.service';
import configured from 'src/shared/database/postgres/postgres.datasource';
import { AppLogger } from 'src/shared/logger/logger.service';
import { httpSecurity } from 'src/shared/security/http-security';
import request from 'supertest';
import { DataSource } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions';

const PASSWORD = 'correct-horse-bat';

describe('Refresh token rotation and reuse detection', () => {
  const database = `cast_refresh_test_${randomUUID().replaceAll('-', '')}`;
  const userId = randomUUID();
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

  async function sessionsOf(): Promise<
    Array<{
      family_id: string;
      consumed_at: Date | null;
      revoked_at: Date | null;
      revoked_reason: string | null;
    }>
  > {
    return db.query(
      `SELECT family_id, consumed_at, revoked_at, revoked_reason
       FROM refresh_sessions ORDER BY created_at ASC`,
    );
  }

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.FRONTEND_ORIGINS = 'http://localhost:5173';
    process.env.JWT_ACCESS_SECRET = 'access-secret-for-e2e-only-0000000000';
    process.env.JWT_REFRESH_SECRET = 'refresh-secret-for-e2e-only-000000000';
    process.env.JWT_ACCESS_EXPIRES_IN = '15m';
    process.env.JWT_REFRESH_EXPIRES_IN = '7d';

    const base = configured.options as PostgresConnectionOptions;
    admin = new DataSource({ ...base, migrations: [], entities: [] });
    await admin.initialize();
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    db = new DataSource({ ...base, database });
    await db.initialize();
    await db.runMigrations();
    await db.query(
      `INSERT INTO users (id, name, email, username, password) VALUES ($1, 'Refresh test', $2, $3, $4)`,
      [
        userId,
        `${userId}@test.invalid`,
        `user${userId.slice(0, 8)}`,
        await bcrypt.hash(PASSWORD, 4),
      ],
    );

    const module = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      controllers: [AuthController],
      providers: [
        AuthService,
        UserService,
        UserRepository,
        RefreshSessionRepository,
        JwtRefreshGuard,
        { provide: 'DATA_SOURCE', useValue: db },
        {
          provide: AppLogger,
          useValue: { error: jest.fn(), log: jest.fn(), warn: jest.fn() },
        },
      ],
    }).compile();

    app = module.createNestApplication();
    app.use(httpSecurity);
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
  });

  async function login() {
    const response = await post('/auth/login')
      .send({ email: `${userId}@test.invalid`, password: PASSWORD })
      .expect(200);
    return response;
  }

  it('never returns the refresh token to JavaScript', async () => {
    const response = await login();

    expect(Object.keys(response.body)).toEqual(['accessToken']);
    expect(JSON.stringify(response.body)).not.toContain('cast_refresh');
    expect(cookieOf(response)).toMatch(/^cast_refresh=/);
  });

  it('stores only a hash of the refresh token', async () => {
    const response = await login();
    const raw = cookieOf(response).slice('cast_refresh='.length);

    const [row] = (await db.query(
      'SELECT token_hash FROM refresh_sessions',
    )) as Array<{ token_hash: string }>;

    expect(row.token_hash).toHaveLength(64);
    expect(row.token_hash).not.toContain(raw);
    expect(raw).not.toContain(row.token_hash);
  });

  it('rotates the token and keeps the family on a legitimate refresh', async () => {
    const first = await login();
    const firstCookie = cookieOf(first);

    const second = await post('/auth/refresh')
      .set('Cookie', firstCookie)
      .expect(200);

    expect(cookieOf(second)).not.toBe(firstCookie);

    const rows = await sessionsOf();
    expect(rows).toHaveLength(2);
    expect(rows[0].family_id).toBe(rows[1].family_id);
    expect(rows[0].consumed_at).not.toBeNull();
    expect(rows[1].consumed_at).toBeNull();
  });

  it('revokes the entire family when a rotated token is replayed', async () => {
    const first = await login();
    const stolen = cookieOf(first);

    const second = await post('/auth/refresh')
      .set('Cookie', stolen)
      .expect(200);
    const legitimate = cookieOf(second);

    await post('/auth/refresh').set('Cookie', stolen).expect(401);

    const rows = await sessionsOf();
    expect(rows.every((row) => row.revoked_at !== null)).toBe(true);
    expect(rows.some((row) => row.revoked_reason === 'reuse_detected')).toBe(
      true,
    );

    await post('/auth/refresh').set('Cookie', legitimate).expect(401);
  });

  it('lets only one of two concurrent refreshes win and kills the family', async () => {
    const first = await login();
    const cookie = cookieOf(first);

    const results = await Promise.all([
      post('/auth/refresh').set('Cookie', cookie),
      post('/auth/refresh').set('Cookie', cookie),
    ]);

    const statuses = results.map((response) => response.status).sort();
    expect(statuses).toEqual([200, 401]);

    const rows = await sessionsOf();
    expect(rows.every((row) => row.revoked_at !== null)).toBe(true);
  });

  it('keeps other devices alive when one family is compromised', async () => {
    const deviceA = cookieOf(await login());
    const deviceB = cookieOf(await login());

    const rotatedA = cookieOf(
      await post('/auth/refresh').set('Cookie', deviceA).expect(200),
    );
    await post('/auth/refresh').set('Cookie', deviceA).expect(401);

    await post('/auth/refresh').set('Cookie', rotatedA).expect(401);
    await post('/auth/refresh').set('Cookie', deviceB).expect(200);
  });

  it('revokes only the current family on logout', async () => {
    const deviceA = cookieOf(await login());
    const deviceB = cookieOf(await login());

    await post('/auth/logout').set('Cookie', deviceA).expect(204);

    await post('/auth/refresh').set('Cookie', deviceA).expect(401);
    await post('/auth/refresh').set('Cookie', deviceB).expect(200);
  });

  it('clears the cookie and stays quiet when logging out without a session', async () => {
    const response = await post('/auth/logout').expect(204);
    const header = response.headers['set-cookie'] as unknown as string[];

    expect(header.some((value) => value.startsWith('cast_refresh=;'))).toBe(
      true,
    );
  });

  it('ignores a forged refresh cookie on logout', async () => {
    const valid = cookieOf(await login());

    await post('/auth/logout')
      .set('Cookie', 'cast_refresh=not.a.real.token')
      .expect(204);

    await post('/auth/refresh').set('Cookie', valid).expect(200);
  });

  it('rejects a refresh without the anti-CSRF header', async () => {
    const cookie = cookieOf(await login());

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Origin', 'http://localhost:5173')
      .set('Cookie', cookie)
      .expect(403);
  });

  it('rejects a refresh from a foreign origin', async () => {
    const cookie = cookieOf(await login());

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Origin', 'https://attacker.test')
      .set('X-Cast-CSRF', '1')
      .set('Cookie', cookie)
      .expect(403);
  });

  it('rejects a refresh with no cookie at all', async () => {
    await post('/auth/refresh').expect(401);
  });

  it('rejects a refresh token signed with the wrong secret', async () => {
    const forged = sign(
      { sub: userId, jti: randomUUID(), fid: randomUUID() },
      'attacker-secret',
      { expiresIn: '7d' },
    );

    await post('/auth/refresh')
      .set('Cookie', `cast_refresh=${forged}`)
      .expect(401);
  });

  it('rejects a validly signed token that has no session row', async () => {
    const familyId = randomUUID();
    const orphan = sign(
      { sub: userId, jti: randomUUID(), fid: familyId },
      process.env.JWT_REFRESH_SECRET as string,
      { expiresIn: '7d' },
    );

    await post('/auth/refresh')
      .set('Cookie', `cast_refresh=${orphan}`)
      .expect(401);
  });

  it('does not let a stolen token from user A rotate into user B', async () => {
    const otherId = randomUUID();
    await db.query(
      `INSERT INTO users (id, name, email, username, password) VALUES ($1, 'Other', $2, $3, $4)`,
      [
        otherId,
        `${otherId}@test.invalid`,
        `user${otherId.slice(0, 8)}`,
        await bcrypt.hash(PASSWORD, 4),
      ],
    );

    const victim = cookieOf(await login());
    const rows = (await db.query(
      'SELECT family_id FROM refresh_sessions LIMIT 1',
    )) as Array<{ family_id: string }>;

    const crafted = sign(
      { sub: otherId, jti: randomUUID(), fid: rows[0].family_id },
      process.env.JWT_REFRESH_SECRET as string,
      { expiresIn: '7d' },
    );

    await post('/auth/refresh')
      .set('Cookie', `cast_refresh=${crafted}`)
      .expect(401);

    await post('/auth/refresh').set('Cookie', victim).expect(200);
    await db.query('DELETE FROM users WHERE id = $1', [otherId]);
  });

  it('drops sessions when the account is deleted', async () => {
    const throwawayId = randomUUID();
    await db.query(
      `INSERT INTO users (id, name, email, username, password) VALUES ($1, 'Throwaway', $2, $3, $4)`,
      [
        throwawayId,
        `${throwawayId}@test.invalid`,
        `user${throwawayId.slice(0, 8)}`,
        await bcrypt.hash(PASSWORD, 4),
      ],
    );

    await post('/auth/login')
      .send({ email: `${throwawayId}@test.invalid`, password: PASSWORD })
      .expect(200);

    await db.query('DELETE FROM users WHERE id = $1', [throwawayId]);

    const rows = (await db.query(
      'SELECT id FROM refresh_sessions WHERE user_id = $1',
      [throwawayId],
    )) as unknown[];
    expect(rows).toHaveLength(0);
  });

  it('rejects a login with the wrong password without creating a session', async () => {
    await post('/auth/login')
      .send({ email: `${userId}@test.invalid`, password: 'wrong-password' })
      .expect(401);

    expect(await sessionsOf()).toHaveLength(0);
  });
});
