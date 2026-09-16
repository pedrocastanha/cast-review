import express, { type Express, type Request } from 'express';
import request from 'supertest';
import type { McpPrincipal } from './introspect-client';
import { createMcpAuthMiddleware } from './mcp-auth.middleware';

function buildApp(reachedFlag: { reached: boolean }): Express {
  const app = express();
  const middleware = createMcpAuthMiddleware({
    backendUrl: 'http://backend.local',
    aiServiceToken: 'service-secret',
    mcpTokenCacheTtlSeconds: 30,
  });
  app.use(middleware);
  app.get('/', (req: Request, res) => {
    reachedFlag.reached = true;
    const principal = (req as Request & { mcpPrincipal?: McpPrincipal })
      .mcpPrincipal;
    res.status(200).json({ principal });
  });
  return app;
}

describe('createMcpAuthMiddleware', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns 401 and never reaches the handler when Authorization header is missing', async () => {
    const reachedFlag = { reached: false };
    const app = buildApp(reachedFlag);

    const response = await request(app).get('/');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
    expect(reachedFlag.reached).toBe(false);
  });

  it('returns 401 when introspection returns a non-200 response', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('invalid', { status: 401 }));
    const reachedFlag = { reached: false };
    const app = buildApp(reachedFlag);

    const response = await request(app)
      .get('/')
      .set('Authorization', 'Bearer mcp_token');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: 'unauthorized' });
    expect(reachedFlag.reached).toBe(false);
  });

  it('reaches the handler with the resolved principal when introspection succeeds', async () => {
    const responseBody = {
      userId: 'user-1',
      projectIds: ['p1'],
      scopes: ['index:read'],
      actingJwt: 'jwt-token',
      actingJwtExpiresAt: '2026-09-16T12:02:00.000Z',
    };
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(responseBody), { status: 200 }),
      );
    const reachedFlag = { reached: false };
    const app = buildApp(reachedFlag);

    const response = await request(app)
      .get('/')
      .set('Authorization', 'Bearer mcp_token');

    expect(response.status).toBe(200);
    expect(reachedFlag.reached).toBe(true);
    expect(response.body.principal).toMatchObject({
      userId: 'user-1',
      projectIds: ['p1'],
      scopes: ['index:read'],
      actingJwt: 'jwt-token',
    });
  });
});
