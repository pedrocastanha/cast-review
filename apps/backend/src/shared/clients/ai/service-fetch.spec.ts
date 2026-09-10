import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { serviceFetch } from './service-fetch';

const USER_KEY = 'sk-user-openai-key-000000';

interface Received {
  authorization?: string;
  body: string;
  path?: string;
}

function listen(
  handler: (
    received: Received,
    respond: (status: number, headers?: Record<string, string>) => void,
  ) => void,
): Promise<{ server: Server; origin: string; received: Received[] }> {
  const received: Received[] = [];

  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const entry: Received = {
        authorization: req.headers.authorization,
        body,
        path: req.url,
      };
      received.push(entry);
      handler(entry, (status, headers) => {
        res.writeHead(status, headers);
        res.end('{}');
      });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, origin: `http://127.0.0.1:${port}`, received });
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve) => server.close(() => resolve()));
}

describe('backend to ai-api transport', () => {
  const environment = { ...process.env };

  afterEach(() => {
    process.env = { ...environment };
  });

  it('refuses to follow a redirect that would leak the payload elsewhere', async () => {
    const attacker = await listen((_received, respond) => respond(200));
    const internal = await listen((_received, respond) =>
      respond(302, { Location: `${attacker.origin}/collect` }),
    );

    process.env.AI_SERVICE_TOKEN = 's'.repeat(32);

    await expect(
      serviceFetch(`${internal.origin}/agent/run`, {
        method: 'POST',
        body: JSON.stringify({ apiKeys: { openai: USER_KEY } }),
      }),
    ).rejects.toThrow();

    expect(attacker.received).toHaveLength(0);

    await close(internal.server);
    await close(attacker.server);
  });

  it('sends the service token and the payload to the configured host only', async () => {
    const internal = await listen((_received, respond) => respond(200));
    process.env.AI_SERVICE_TOKEN = 's'.repeat(32);

    await serviceFetch(`${internal.origin}/agent/run`, {
      method: 'POST',
      body: JSON.stringify({ apiKeys: { openai: USER_KEY } }),
    });

    expect(internal.received[0].authorization).toBe(`Bearer ${'s'.repeat(32)}`);
    expect(internal.received[0].body).toContain(USER_KEY);

    await close(internal.server);
  });

  it('never puts the user credential in the URL', async () => {
    const internal = await listen((_received, respond) => respond(200));
    process.env.AI_SERVICE_TOKEN = 's'.repeat(32);

    await serviceFetch(`${internal.origin}/agent/run`, {
      method: 'POST',
      body: JSON.stringify({ apiKeys: { openai: USER_KEY } }),
    });

    expect(internal.received[0].path).toBe('/agent/run');
    expect(internal.received[0].path).not.toContain('sk-');

    await close(internal.server);
  });

  it('fails closed in production when the service token is missing', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.AI_SERVICE_TOKEN;

    expect(() => serviceFetch('https://ai.internal/agent/run')).toThrow(
      /AI_SERVICE_TOKEN/,
    );
  });

  it('fails closed in production when the service token is weak', async () => {
    process.env.NODE_ENV = 'production';
    process.env.AI_SERVICE_TOKEN = 'short';

    expect(() => serviceFetch('https://ai.internal/agent/run')).toThrow(
      /AI_SERVICE_TOKEN/,
    );
  });

  it('applies a timeout so a hung dependency cannot pin the request open', async () => {
    process.env.AI_SERVICE_TOKEN = 's'.repeat(32);
    const spy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}'));

    await serviceFetch('http://127.0.0.1:1/agent/run', { method: 'POST' });

    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.redirect).toBe('error');

    spy.mockRestore();
  });

  it('lets an explicit caller signal win over the default timeout', async () => {
    process.env.AI_SERVICE_TOKEN = 's'.repeat(32);
    const controller = new AbortController();
    const spy = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('{}'));

    await serviceFetch('http://127.0.0.1:1/agent/run', {
      signal: controller.signal,
    });

    const init = spy.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBe(controller.signal);

    spy.mockRestore();
  });
});
