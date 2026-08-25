import type { AppLogger } from 'src/shared/logger/logger.service';
import type { AgentResumeRequest, AgentRunRequest } from 'src/shared/types';
import { AiApiClient } from './ai-api.client';

const payload: AgentRunRequest = {
  diff: '',
  changedFiles: [],
  conventions: '',
  models: { testReviewer: 'gpt-4o', architectureReviewer: 'gpt-4o' },
  apiKeys: { openai: 'sk-test' },
};

const resumePayload: AgentResumeRequest = {
  analysisId: 'analysis-1',
  models: { testReviewer: 'gpt-4o', architectureReviewer: 'gpt-4o' },
  apiKeys: { openai: 'sk-test' },
  policies: { prd: 'manual', spec: 'manual' },
  decision: { stage: 'prd', action: 'approve' },
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

function sseStreamResponse(events: Array<Record<string, unknown>>): Response {
  const encoder = new TextEncoder();
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join('');
  const chunk = encoder.encode(body);
  let read = false;

  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () => {
          if (read) return { done: true, value: undefined };
          read = true;
          return { done: false, value: chunk };
        },
        releaseLock: () => undefined,
      }),
    },
  } as unknown as Response;
}

function notOkResponse(status: number): Response {
  return {
    ok: false,
    status,
    body: null,
  } as unknown as Response;
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
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

describe('AiApiClient.resumeAgent', () => {
  const originalUrl = process.env.AI_API_URL;
  const fetchMock = jest.fn();
  const logger = { error: jest.fn() } as unknown as AppLogger;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterAll(() => {
    if (originalUrl === undefined) {
      delete process.env.AI_API_URL;
    } else {
      process.env.AI_API_URL = originalUrl;
    }
  });

  it('faz POST em /agent/resume e emite os eventos SSE parseados', async () => {
    process.env.AI_API_URL = 'http://localhost:8000';
    fetchMock.mockResolvedValue(
      sseStreamResponse([
        { type: 'spec_generated', payload: { foo: 'bar' } },
        { type: 'report_ready', payload: {} },
      ]),
    );
    const client = new AiApiClient(logger);

    const events: unknown[] = [];
    for await (const event of client.resumeAgent(
      resumePayload,
      new AbortController().signal,
    )) {
      events.push(event);
    }

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/agent/resume',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(resumePayload),
      }),
    );
    expect(events).toEqual([
      { type: 'spec_generated', payload: { foo: 'bar' } },
      { type: 'report_ready', payload: {} },
    ]);
  });

  it('lança erro quando a resposta não é ok', async () => {
    process.env.AI_API_URL = 'http://localhost:8000';
    fetchMock.mockResolvedValue(notOkResponse(500));
    const client = new AiApiClient(logger);

    await expect(
      client.resumeAgent(resumePayload, new AbortController().signal).next(),
    ).rejects.toThrow('ai-api indisponível (status 500)');
  });
});

describe('AiApiClient.getProjectGraph', () => {
  const fetchMock = jest.fn();
  const logger = { error: jest.fn() } as unknown as AppLogger;

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('posts only the authorized project id and repository sha references', async () => {
    const responseBody = { nodes: [], edges: [], stats: { repositories: 2 } };
    fetchMock.mockResolvedValue(jsonResponse(responseBody));
    const client = new AiApiClient(logger);
    const requestBody = {
      projectId: 'project-1',
      repositories: [
        { repoId: 'cast/frontend', sha: 'front-sha' },
        { repoId: 'cast/backend', sha: null },
      ],
    };

    const result = await client.getProjectGraph(requestBody);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8000/index/project/graph',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(requestBody) }),
    );
    expect(result).toEqual(responseBody);
  });
});
