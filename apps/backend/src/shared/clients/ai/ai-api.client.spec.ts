import type { AppLogger } from 'src/shared/logger/logger.service';
import type { AgentRunRequest } from 'src/shared/types';
import { AiApiClient } from './ai-api.client';

const payload: AgentRunRequest = {
  diff: '',
  changedFiles: [],
  conventions: '',
  models: { testReviewer: 'gpt-4o', architectureReviewer: 'gpt-4o' },
  apiKeys: { openai: 'sk-test' },
};

function emptyStreamResponse(): Response {
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => ({ done: true, value: undefined }),
        releaseLock: () => undefined,
      }),
    },
  } as unknown as Response;
}

describe('AiApiClient', () => {
  const originalUrl = process.env.AI_API_URL;
  const fetchMock = jest.fn();
  const logger = { error: jest.fn() } as unknown as AppLogger;

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(emptyStreamResponse());
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    if (originalUrl === undefined) {
      delete process.env.AI_API_URL;
    } else {
      process.env.AI_API_URL = originalUrl;
    }
  });

  it('lê AI_API_URL no momento do request, não no import do módulo', async () => {
    process.env.AI_API_URL = 'http://localhost:8000';
    const client = new AiApiClient(logger);

    process.env.AI_API_URL = 'http://localhost:8034';
    await client.runAgent(payload, new AbortController().signal).next();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8034/agent/run',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('cai no default :8000 quando AI_API_URL não está setada', async () => {
    delete process.env.AI_API_URL;
    const client = new AiApiClient(logger);

    await client.runAgent(payload, new AbortController().signal).next();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/agent/run',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
