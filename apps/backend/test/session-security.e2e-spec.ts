import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { JwtRefreshGuard } from '../src/modules/auth/guards/jwt-refresh.guard';
import { httpSecurity } from '../src/shared/security/http-security';

describe('HTTP session boundary', () => {
  let app: INestApplication;
  const env = { ...process.env };
  beforeAll(async () => {
    process.env.NODE_ENV = 'production';
    process.env.FRONTEND_ORIGINS = 'https://cast.test';
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        {
          provide: AuthService,
          useValue: {
            login: jest.fn().mockResolvedValue({
              accessToken: 'access',
              refreshToken: 'private-refresh',
            }),
          },
        },
      ],
    })
      .overrideGuard(JwtRefreshGuard)
      .useValue({ canActivate: () => false })
      .compile();
    app = module.createNestApplication();
    app.use(httpSecurity);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
    process.env = env;
  });
  it('does not disclose refresh credentials in JSON', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', 'https://cast.test')
      .set('X-Cast-CSRF', '1')
      .send({ email: 'test@example.test', password: 'password' })
      .expect(200);
    expect(response.body).toEqual({ accessToken: 'access' });
    const cookie = response.headers['set-cookie'][0];
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Strict');
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it.each(['/auth/login', '/AUTH/LOGIN/'])(
    'rejects a forged browser origin at %s',
    async (path) => {
      await request(app.getHttpServer())
        .post(path)
        .set('Origin', 'https://attacker.test')
        .set('X-Cast-CSRF', '1')
        .send({})
        .expect(403);
    },
  );
  it('rejects a simple form request', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .set('Origin', 'https://cast.test')
      .send({})
      .expect(403);
  });
});
