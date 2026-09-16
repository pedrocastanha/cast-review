import type { McpPrincipal } from '../auth/introspect-client';
import { runWithPrincipal } from '../auth/principal-context';
import type { AiApiClient } from '../clients/ai-api.client';
import { registerIndexTools } from './index-tools';

type ToolCallback = (args: any) => Promise<any>;

interface FakeServer {
  registerTool: jest.Mock;
  callbacks: Map<string, ToolCallback>;
}

function createFakeServer(): FakeServer {
  const callbacks = new Map<string, ToolCallback>();
  const registerTool = jest.fn(
    (name: string, _config: unknown, cb: ToolCallback) => {
      callbacks.set(name, cb);
    },
  );
  return { registerTool, callbacks };
}

function createFakePrincipal(
  overrides: Partial<McpPrincipal> = {},
): McpPrincipal {
  return {
    userId: 'user-1',
    projectIds: [],
    scopes: [],
    actingJwt: 'jwt',
    actingJwtExpiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

function createFakeAiApiClient(
  overrides: Partial<AiApiClient> = {},
): AiApiClient {
  return {
    buildIndex: jest.fn(),
    getIndexStatus: jest.fn(),
    getRelatedContext: jest.fn(),
    ...overrides,
  } as AiApiClient;
}

describe('registerIndexTools', () => {
  describe('index_repository', () => {
    it('denies and never calls buildIndex when ownerId does not match the principal', async () => {
      const fakeServer = createFakeServer();
      const buildIndex = jest.fn();
      const aiApiClient = createFakeAiApiClient({ buildIndex });
      registerIndexTools(fakeServer as any, { aiApiClient });
      const cb = fakeServer.callbacks.get('index_repository')!;
      const principal = createFakePrincipal({ userId: 'user-1' });

      const result = await runWithPrincipal(principal, () =>
        cb({ ownerId: 'other-user', repoId: 'r1', sha: 'sha1', files: [] }),
      );

      expect(result.isError).toBe(true);
      expect(buildIndex).not.toHaveBeenCalled();
    });

    it('calls buildIndex with the exact input and returns its result when ownerId matches', async () => {
      const fakeServer = createFakeServer();
      const buildIndexResult = {
        indexId: 'idx1',
        indexedFiles: 1,
        skippedFiles: 0,
        reusedFiles: 0,
        truncated: false,
        durationMs: 5,
      };
      const buildIndex = jest.fn().mockResolvedValue(buildIndexResult);
      const aiApiClient = createFakeAiApiClient({ buildIndex });
      registerIndexTools(fakeServer as any, { aiApiClient });
      const cb = fakeServer.callbacks.get('index_repository')!;
      const principal = createFakePrincipal({ userId: 'user-1' });
      const input = {
        ownerId: 'user-1',
        repoId: 'r1',
        sha: 'sha1',
        files: [{ path: 'a.ts', content: 'x' }],
      };

      const result = await runWithPrincipal(principal, () => cb(input));

      expect(buildIndex).toHaveBeenCalledWith(input);
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toBe(JSON.stringify(buildIndexResult));
    });

    it('returns isError with the verbatim message when buildIndex rejects', async () => {
      const fakeServer = createFakeServer();
      const buildIndex = jest
        .fn()
        .mockRejectedValue(
          new Error('ai-api request failed with status 409: locked'),
        );
      const aiApiClient = createFakeAiApiClient({ buildIndex });
      registerIndexTools(fakeServer as any, { aiApiClient });
      const cb = fakeServer.callbacks.get('index_repository')!;
      const principal = createFakePrincipal({ userId: 'user-1' });

      const result = await runWithPrincipal(principal, () =>
        cb({ ownerId: 'user-1', repoId: 'r1', sha: 'sha1', files: [] }),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe(
        'ai-api request failed with status 409: locked',
      );
    });
  });

  describe('get_index_status', () => {
    it('calls getIndexStatus and returns its result when ownerId matches', async () => {
      const fakeServer = createFakeServer();
      const statusResult = { indexed: true, sha: 'sha1' };
      const getIndexStatus = jest.fn().mockResolvedValue(statusResult);
      const aiApiClient = createFakeAiApiClient({ getIndexStatus });
      registerIndexTools(fakeServer as any, { aiApiClient });
      const cb = fakeServer.callbacks.get('get_index_status')!;
      const principal = createFakePrincipal({ userId: 'user-1' });

      const result = await runWithPrincipal(principal, () =>
        cb({ ownerId: 'user-1', repoId: 'r1' }),
      );

      expect(getIndexStatus).toHaveBeenCalledWith({
        ownerId: 'user-1',
        repoId: 'r1',
      });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toBe(JSON.stringify(statusResult));
    });

    it('denies and never calls getIndexStatus when ownerId does not match', async () => {
      const fakeServer = createFakeServer();
      const getIndexStatus = jest.fn();
      const aiApiClient = createFakeAiApiClient({ getIndexStatus });
      registerIndexTools(fakeServer as any, { aiApiClient });
      const cb = fakeServer.callbacks.get('get_index_status')!;
      const principal = createFakePrincipal({ userId: 'user-1' });

      const result = await runWithPrincipal(principal, () =>
        cb({ ownerId: 'other-user', repoId: 'r1' }),
      );

      expect(result.isError).toBe(true);
      expect(getIndexStatus).not.toHaveBeenCalled();
    });
  });

  describe('get_related_context', () => {
    it('calls getRelatedContext with the input including tokenBudget when ownerId matches', async () => {
      const fakeServer = createFakeServer();
      const contextResult = { snippets: [] };
      const getRelatedContext = jest.fn().mockResolvedValue(contextResult);
      const aiApiClient = createFakeAiApiClient({ getRelatedContext });
      registerIndexTools(fakeServer as any, { aiApiClient });
      const cb = fakeServer.callbacks.get('get_related_context')!;
      const principal = createFakePrincipal({ userId: 'user-1' });
      const input = {
        ownerId: 'user-1',
        repoId: 'r1',
        sha: 'sha1',
        changedFiles: ['a.ts'],
        tokenBudget: 2000,
      };

      const result = await runWithPrincipal(principal, () => cb(input));

      expect(getRelatedContext).toHaveBeenCalledWith(input);
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toBe(JSON.stringify(contextResult));
    });

    it('denies and never calls getRelatedContext when ownerId does not match', async () => {
      const fakeServer = createFakeServer();
      const getRelatedContext = jest.fn();
      const aiApiClient = createFakeAiApiClient({ getRelatedContext });
      registerIndexTools(fakeServer as any, { aiApiClient });
      const cb = fakeServer.callbacks.get('get_related_context')!;
      const principal = createFakePrincipal({ userId: 'user-1' });

      const result = await runWithPrincipal(principal, () =>
        cb({
          ownerId: 'other-user',
          repoId: 'r1',
          sha: 'sha1',
          changedFiles: [],
        }),
      );

      expect(result.isError).toBe(true);
      expect(getRelatedContext).not.toHaveBeenCalled();
    });
  });
});
