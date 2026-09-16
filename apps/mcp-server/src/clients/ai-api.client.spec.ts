import { createAiApiClient } from './ai-api.client';

describe('createAiApiClient', () => {
  const config = {
    aiApiUrl: 'http://ai-api.local',
    aiServiceToken: 'secret-token',
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('buildIndex', () => {
    it('calls POST /index/build with the fixed bearer token', async () => {
      const responseBody = {
        indexId: 'idx1',
        indexedFiles: 1,
        skippedFiles: 0,
        reusedFiles: 0,
        truncated: false,
        durationMs: 10,
      };
      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify(responseBody), { status: 200 }),
        );

      const client = createAiApiClient(config);
      const result = await client.buildIndex({
        ownerId: 'o1',
        repoId: 'r1',
        sha: 'sha1',
        files: [],
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://ai-api.local/index/build');
      expect(init?.method).toBe('POST');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer secret-token');
      expect(result).toEqual(responseBody);
    });

    it('rejects with an Error containing the upstream status on non-2xx', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response('lock held', { status: 409 }));

      const client = createAiApiClient(config);

      await expect(
        client.buildIndex({
          ownerId: 'o1',
          repoId: 'r1',
          sha: 'sha1',
          files: [],
        }),
      ).rejects.toThrow(/409/);
    });
  });

  describe('getIndexStatus', () => {
    it('calls GET /index/status with query params and the fixed bearer token', async () => {
      const responseBody = { indexed: true, sha: 'sha1' };
      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify(responseBody), { status: 200 }),
        );

      const client = createAiApiClient(config);
      const result = await client.getIndexStatus({
        ownerId: 'o1',
        repoId: 'r1',
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://ai-api.local/index/status?repoId=r1&ownerId=o1');
      expect(init?.method).toBe('GET');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer secret-token');
      expect(result).toEqual(responseBody);
    });

    it('rejects with an Error containing the upstream status on non-2xx', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response('boom', { status: 500 }));

      const client = createAiApiClient(config);

      await expect(
        client.getIndexStatus({ ownerId: 'o1', repoId: 'r1' }),
      ).rejects.toThrow(/500/);
    });
  });

  describe('getRelatedContext', () => {
    it('calls POST /index/context with the fixed bearer token', async () => {
      const responseBody = { anything: 'passthrough' };
      const fetchMock = jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify(responseBody), { status: 200 }),
        );

      const client = createAiApiClient(config);
      const result = await client.getRelatedContext({
        ownerId: 'o1',
        repoId: 'r1',
        sha: 'sha1',
        changedFiles: ['a.ts'],
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('http://ai-api.local/index/context');
      expect(init?.method).toBe('POST');
      const headers = new Headers(init?.headers);
      expect(headers.get('Authorization')).toBe('Bearer secret-token');
      expect(result).toEqual(responseBody);
    });

    it('rejects with an Error containing the upstream status on non-2xx', async () => {
      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response('bad request', { status: 400 }));

      const client = createAiApiClient(config);

      await expect(
        client.getRelatedContext({
          ownerId: 'o1',
          repoId: 'r1',
          sha: 'sha1',
          changedFiles: [],
        }),
      ).rejects.toThrow(/400/);
    });
  });
});
