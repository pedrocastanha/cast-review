import type { McpPrincipal } from '../auth/introspect-client';
import { runWithPrincipal } from '../auth/principal-context';
import type { BackendClient } from '../clients/backend.client';
import { registerAnalysisTools } from './analysis-tools';

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

function createFakeBackendClient(
  overrides: Partial<BackendClient> = {},
): BackendClient {
  return {
    runPrAnalysis: jest.fn(),
    getAnalysis: jest.fn(),
    ...overrides,
  } as BackendClient;
}

function fakeHeaders(values: Record<string, string>): Response['headers'] {
  const map = new Map(
    Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]),
  );
  return {
    get: (name: string) => map.get(name.toLowerCase()) ?? null,
  } as unknown as Response['headers'];
}

function fakeReaderResponse(input: {
  ok: boolean;
  status?: number;
  text?: () => Promise<string>;
  headers?: Record<string, string>;
  chunks?: string[];
}): Response {
  const encoder = new TextEncoder();
  const chunks = input.chunks ?? [];
  let index = 0;
  const cancel = jest.fn().mockResolvedValue(undefined);

  return {
    ok: input.ok,
    status: input.status ?? (input.ok ? 200 : 500),
    text: input.text ?? (async () => ''),
    headers: fakeHeaders(input.headers ?? {}),
    body: {
      getReader: () => ({
        read: async () => {
          if (index < chunks.length) {
            const chunk = chunks[index];
            index += 1;
            return { value: encoder.encode(chunk), done: false };
          }
          return { value: undefined, done: true };
        },
        cancel,
      }),
      cancel,
    },
  } as unknown as Response;
}

describe('registerAnalysisTools', () => {
  describe('run_pr_analysis', () => {
    it('always sends policies.publish auto_safe even though the tool has no policies input', async () => {
      const fakeServer = createFakeServer();
      const runPrAnalysis = jest.fn().mockResolvedValue(
        fakeReaderResponse({
          ok: true,
          headers: { 'x-analysis-id': 'an-1' },
        }),
      );
      const backendClient = createFakeBackendClient({ runPrAnalysis });
      registerAnalysisTools(fakeServer as any, { backendClient });
      const cb = fakeServer.callbacks.get('run_pr_analysis')!;
      const principal = createFakePrincipal();

      await runWithPrincipal(principal, () =>
        cb({
          owner: 'acme',
          repo: 'widgets',
          pullNumber: 42,
          models: { testReviewer: 'gpt', architectureReviewer: 'gpt' },
          impactScope: { mode: 'repository' },
        }),
      );

      expect(runPrAnalysis).toHaveBeenCalledWith(
        'jwt',
        'acme',
        'widgets',
        '42',
        expect.objectContaining({ policies: { publish: 'auto_safe' } }),
      );
    });

    it('returns isError with the upstream body text when the response is not ok', async () => {
      const fakeServer = createFakeServer();
      const runPrAnalysis = jest.fn().mockResolvedValue(
        fakeReaderResponse({
          ok: false,
          status: 422,
          text: async () => 'invalid model name',
        }),
      );
      const backendClient = createFakeBackendClient({ runPrAnalysis });
      registerAnalysisTools(fakeServer as any, { backendClient });
      const cb = fakeServer.callbacks.get('run_pr_analysis')!;
      const principal = createFakePrincipal();

      const result = await runWithPrincipal(principal, () =>
        cb({
          owner: 'acme',
          repo: 'widgets',
          pullNumber: 42,
          models: { testReviewer: 'gpt', architectureReviewer: 'gpt' },
          impactScope: { mode: 'repository' },
        }),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('invalid model name');
    });

    it('returns analysisId and status running from the X-Analysis-Id response header', async () => {
      const fakeServer = createFakeServer();
      const runPrAnalysis = jest.fn().mockResolvedValue(
        fakeReaderResponse({
          ok: true,
          headers: { 'X-Analysis-Id': 'an-header-1' },
        }),
      );
      const backendClient = createFakeBackendClient({ runPrAnalysis });
      registerAnalysisTools(fakeServer as any, { backendClient });
      const cb = fakeServer.callbacks.get('run_pr_analysis')!;
      const principal = createFakePrincipal();

      const result = await runWithPrincipal(principal, () =>
        cb({
          owner: 'acme',
          repo: 'widgets',
          pullNumber: 42,
          models: { testReviewer: 'gpt', architectureReviewer: 'gpt' },
          impactScope: { mode: 'repository' },
        }),
      );

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toBe(
        JSON.stringify({ analysisId: 'an-header-1', status: 'running' }),
      );
    });

    it('falls back to reading the SSE stream for analysisId when no header is present', async () => {
      const fakeServer = createFakeServer();
      const runPrAnalysis = jest.fn().mockResolvedValue(
        fakeReaderResponse({
          ok: true,
          headers: {},
          chunks: [
            'data: {"type":"started","payload":{"analysisId":"an-stream-1"}}\n\n',
          ],
        }),
      );
      const backendClient = createFakeBackendClient({ runPrAnalysis });
      registerAnalysisTools(fakeServer as any, { backendClient });
      const cb = fakeServer.callbacks.get('run_pr_analysis')!;
      const principal = createFakePrincipal();

      const result = await runWithPrincipal(principal, () =>
        cb({
          owner: 'acme',
          repo: 'widgets',
          pullNumber: 42,
          models: { testReviewer: 'gpt', architectureReviewer: 'gpt' },
          impactScope: { mode: 'repository' },
        }),
      );

      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toBe(
        JSON.stringify({ analysisId: 'an-stream-1', status: 'running' }),
      );
    });
  });

  describe('get_analysis', () => {
    it('returns the analysis JSON on success', async () => {
      const fakeServer = createFakeServer();
      const analysis = { id: 'an-1', status: 'completed' };
      const getAnalysis = jest.fn().mockResolvedValue(analysis);
      const backendClient = createFakeBackendClient({ getAnalysis });
      registerAnalysisTools(fakeServer as any, { backendClient });
      const cb = fakeServer.callbacks.get('get_analysis')!;
      const principal = createFakePrincipal();

      const result = await runWithPrincipal(principal, () =>
        cb({ analysisId: 'an-1' }),
      );

      expect(getAnalysis).toHaveBeenCalledWith('jwt', 'an-1');
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).toBe(JSON.stringify(analysis));
    });

    it('returns a generic not found error when the client throws a 404', async () => {
      const fakeServer = createFakeServer();
      const getAnalysis = jest
        .fn()
        .mockRejectedValue(
          new Error(
            'backend request failed with status 404: Análise não encontrada',
          ),
        );
      const backendClient = createFakeBackendClient({ getAnalysis });
      registerAnalysisTools(fakeServer as any, { backendClient });
      const cb = fakeServer.callbacks.get('get_analysis')!;
      const principal = createFakePrincipal();

      const result = await runWithPrincipal(principal, () =>
        cb({ analysisId: 'an-missing' }),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe('analysis not found');
      expect(result.content[0].text).not.toContain('Análise não encontrada');
    });

    it('forwards non-404 errors verbatim', async () => {
      const fakeServer = createFakeServer();
      const getAnalysis = jest
        .fn()
        .mockRejectedValue(
          new Error(
            'backend request failed with status 500: openai key missing',
          ),
        );
      const backendClient = createFakeBackendClient({ getAnalysis });
      registerAnalysisTools(fakeServer as any, { backendClient });
      const cb = fakeServer.callbacks.get('get_analysis')!;
      const principal = createFakePrincipal();

      const result = await runWithPrincipal(principal, () =>
        cb({ analysisId: 'an-1' }),
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toBe(
        'backend request failed with status 500: openai key missing',
      );
    });
  });
});
