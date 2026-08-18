const GITHUB_HOST = 'api.github.com';

export type GithubFetchCall = { method: string; pathname: string };

export interface GithubFetchStubConfig {
  owner: string;
  repo: string;
  pullNumber: number;
  headRef: string;
  headSha: string;
  baseRef: string;
  diff: string;
  files: { filename: string; status: string; patch?: string }[];
  /** path -> file content; a missing/`null` entry serves a 404 (e.g. conventions.md). */
  fileContents: Record<string, string | null>;
}

export interface GithubFetchStub {
  /** Every request routed to api.github.com, in order. */
  allCalls: GithubFetchCall[];
  /** Subset of `allCalls` with a non-GET method — the "write" surface. */
  writeCalls: GithubFetchCall[];
  restore(): void;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}

function notFoundResponse(): Response {
  return jsonResponse({ message: 'Not Found' }, 404);
}

export function installGithubFetchStub(
  config: GithubFetchStubConfig,
): GithubFetchStub {
  const originalFetch = globalThis.fetch;
  const allCalls: GithubFetchCall[] = [];
  const writeCalls: GithubFetchCall[] = [];

  const pullsBase = `/repos/${config.owner}/${config.repo}/pulls/${config.pullNumber}`;
  const contentsPrefix = `/repos/${config.owner}/${config.repo}/contents/`;

  const stub = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    const isRequestObject =
      typeof Request !== 'undefined' && input instanceof Request;
    const rawUrl = isRequestObject ? (input as Request).url : String(input);
    const parsed = new URL(rawUrl);

    if (parsed.hostname !== GITHUB_HOST) {
      return originalFetch(input as never, init as never);
    }

    const method = (
      init?.method ??
      (isRequestObject ? (input as Request).method : 'GET')
    ).toUpperCase();

    const call: GithubFetchCall = { method, pathname: parsed.pathname };
    allCalls.push(call);
    if (method !== 'GET') writeCalls.push(call);

    const headers = new Headers(
      init?.headers ?? (isRequestObject ? (input as Request).headers : {}),
    );
    const accept = headers.get('accept') ?? '';

    // GET /repos/:owner/:repo/pulls/:number (plain JSON, or raw diff text
    // when Octokit requests the diff media type — same route, different
    // Accept header; both getPullByNumber/getPullHeadSha and getPullDiff
    // land here).
    if (method === 'GET' && parsed.pathname === pullsBase) {
      if (accept.includes('diff')) {
        return textResponse(config.diff);
      }
      return jsonResponse({
        id: 1,
        number: config.pullNumber,
        title: 'e2e test PR',
        state: 'open',
        user: { login: config.owner },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        html_url: `https://github.com/${config.owner}/${config.repo}/pull/${config.pullNumber}`,
        draft: false,
        head: { ref: config.headRef, sha: config.headSha },
        base: { ref: config.baseRef },
      });
    }

    if (method === 'GET' && parsed.pathname === `${pullsBase}/files`) {
      return jsonResponse(config.files);
    }

    if (method === 'GET' && parsed.pathname === `${pullsBase}/comments`) {
      return jsonResponse([]);
    }

    if (method === 'GET' && parsed.pathname.startsWith(contentsPrefix)) {
      const path = decodeURIComponent(
        parsed.pathname.slice(contentsPrefix.length),
      );
      const content = config.fileContents[path];
      if (content == null) return notFoundResponse();
      return jsonResponse({
        type: 'file',
        encoding: 'base64',
        content: Buffer.from(content, 'utf-8').toString('base64'),
      });
    }

    if (method === 'POST' && parsed.pathname === `${pullsBase}/reviews`) {
      return jsonResponse(
        {
          id: 987654321,
          html_url: `https://github.com/${config.owner}/${config.repo}/pull/${config.pullNumber}#pullrequestreview-987654321`,
        },
        200,
      );
    }

    if (
      method === 'DELETE' &&
      parsed.pathname.startsWith(`/repos/${config.owner}/${config.repo}/pulls/comments/`)
    ) {
      return new Response(null, { status: 204 });
    }

    throw new Error(
      `github-fetch-stub: unhandled request ${method} ${parsed.pathname}`,
    );
  }) as typeof fetch;

  globalThis.fetch = stub;

  return {
    allCalls,
    writeCalls,
    restore() {
      globalThis.fetch = originalFetch;
    },
  };
}
