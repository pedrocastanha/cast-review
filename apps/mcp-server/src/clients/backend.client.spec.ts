import { createBackendClient } from './backend.client';

describe('createBackendClient', () => {
  const config = { backendUrl: 'http://backend.local' };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('runPrAnalysis', () => {
    it('calls POST /repositories/:repo/pulls/:pullNumber/analyses with the acting JWT and does not parse the body', async () => {
      const rawResponse = new Response('event: data\n\n', { status: 200 });
      const jsonSpy = jest.spyOn(rawResponse, 'json');
      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(rawResponse);

      const client = createBackendClient(config);
      const body = {
        models: { testReviewer: 'm1', architectureReviewer: 'm2' },
        impactScope: { mode: 'repository' },
      };
      const result = await client.runPrAnalysis(
        'acting-jwt',
        'acme',
        'repo1',
        '42',
        body,
      );

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(
        'http://backend.local/repositories/repo1/pulls/42/analyses?owner=acme',
      );
      expect(init?.method).toBe('POST');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer acting-jwt');
      expect(result).toBe(rawResponse);
      expect(jsonSpy).not.toHaveBeenCalled();
    });
  });

  describe('getAnalysis', () => {
    it('calls GET /analyses/:id with the acting JWT', async () => {
      const responseBody = { id: 'a1', status: 'running' };
      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify(responseBody), { status: 200 }),
        );

      const client = createBackendClient(config);
      const result = await client.getAnalysis('acting-jwt', 'a1');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://backend.local/analyses/a1');
      expect(init?.method).toBe('GET');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer acting-jwt');
      expect(result).toEqual(responseBody);
    });

    it('rejects with an Error containing the upstream status on non-2xx', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response('not found', { status: 404 }));

      const client = createBackendClient(config);

      await expect(client.getAnalysis('acting-jwt', 'missing')).rejects.toThrow(
        /404/,
      );
    });
  });
});
