import {
  createIntrospectClient,
  IntrospectionFailedError,
} from './introspect-client';

describe('createIntrospectClient', () => {
  const config = {
    backendUrl: 'http://backend.local',
    aiServiceToken: 'service-secret',
    mcpTokenCacheTtlSeconds: 30,
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns a correctly-shaped McpPrincipal on a 200 response', async () => {
    const responseBody = {
      userId: 'user-1',
      projectIds: ['p1', 'p2'],
      scopes: ['index:read', 'index:write'],
      actingJwt: 'jwt-token',
      actingJwtExpiresAt: '2026-09-16T12:02:00.000Z',
    };
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(responseBody), { status: 200 }),
      );

    const client = createIntrospectClient(config);
    const principal = await client.introspect('mcp_raw_token');

    expect(principal).toEqual({
      userId: 'user-1',
      projectIds: ['p1', 'p2'],
      scopes: ['index:read', 'index:write'],
      actingJwt: 'jwt-token',
      actingJwtExpiresAt: new Date('2026-09-16T12:02:00.000Z'),
    });
  });

  it('throws IntrospectionFailedError on a non-200 response', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('invalid', { status: 401 }));

    const client = createIntrospectClient(config);

    await expect(client.introspect('bad-token')).rejects.toThrow(
      IntrospectionFailedError,
    );
  });

  it('throws IntrospectionFailedError when fetch rejects with a network error', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network down'));

    const client = createIntrospectClient(config);

    await expect(client.introspect('any-token')).rejects.toThrow(
      IntrospectionFailedError,
    );
  });

  it('caches a successful introspection and skips the network call within the TTL', async () => {
    const responseBody = {
      userId: 'user-1',
      projectIds: [],
      scopes: [],
      actingJwt: 'jwt-token',
      actingJwtExpiresAt: '2026-09-16T12:02:00.000Z',
    };
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(responseBody), { status: 200 }),
      );

    const client = createIntrospectClient(config);
    await client.introspect('same-token');
    await client.introspect('same-token');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('makes a second network call once the cache entry expires past the TTL', async () => {
    const responseBody = {
      userId: 'user-1',
      projectIds: [],
      scopes: [],
      actingJwt: 'jwt-token',
      actingJwtExpiresAt: '2026-09-16T12:02:00.000Z',
    };
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(
        async () => new Response(JSON.stringify(responseBody), { status: 200 }),
      );
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);

    const client = createIntrospectClient({
      ...config,
      mcpTokenCacheTtlSeconds: 1,
    });
    await client.introspect('same-token');

    nowSpy.mockReturnValue(1_000_000 + 2_000);
    await client.introspect('same-token');

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
