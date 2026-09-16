import express, { type Express } from 'express';
import request from 'supertest';
import type { Config } from './config';
import { createMcpRateLimiters } from './rate-limit';

function buildApp(
  config: Pick<
    Config,
    'rateLimitPerTokenPerMinute' | 'rateLimitPerIpPerMinute'
  >,
): Express {
  const app = express();
  app.use(createMcpRateLimiters(config));
  app.get('/', (_req, res) => {
    res.status(200).json({ ok: true });
  });
  return app;
}

describe('createMcpRateLimiters', () => {
  it('allows requests under the per-IP limit through', async () => {
    const app = buildApp({
      rateLimitPerTokenPerMinute: 3,
      rateLimitPerIpPerMinute: 10,
    });

    for (let i = 0; i < 3; i++) {
      const response = await request(app)
        .get('/')
        .set('Authorization', `Bearer token-${i}`);
      expect(response.status).toBe(200);
    }
  });

  it('returns 429 once the per-token limit is exceeded', async () => {
    const app = buildApp({
      rateLimitPerTokenPerMinute: 3,
      rateLimitPerIpPerMinute: 100,
    });
    const token = 'Bearer same-token';

    for (let i = 0; i < 3; i++) {
      const response = await request(app).get('/').set('Authorization', token);
      expect(response.status).toBe(200);
    }

    const blocked = await request(app).get('/').set('Authorization', token);

    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'rate limit exceeded' });
  });

  it('returns 429 once the per-IP limit is exceeded, even across different tokens', async () => {
    const app = buildApp({
      rateLimitPerTokenPerMinute: 100,
      rateLimitPerIpPerMinute: 3,
    });

    for (let i = 0; i < 3; i++) {
      const response = await request(app)
        .get('/')
        .set('Authorization', `Bearer token-${i}`);
      expect(response.status).toBe(200);
    }

    const blocked = await request(app)
      .get('/')
      .set('Authorization', 'Bearer token-blocked');

    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({ error: 'rate limit exceeded' });
  });

  it('buckets unauthenticated requests under a shared anonymous token key', async () => {
    const app = buildApp({
      rateLimitPerTokenPerMinute: 2,
      rateLimitPerIpPerMinute: 100,
    });

    const first = await request(app).get('/');
    const second = await request(app).get('/');
    const third = await request(app).get('/');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(429);
  });
});
