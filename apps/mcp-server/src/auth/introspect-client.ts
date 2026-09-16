export interface McpPrincipal {
  userId: string;
  projectIds: string[];
  scopes: string[];
  actingJwt: string;
  actingJwtExpiresAt: Date;
}

export class IntrospectionFailedError extends Error {
  constructor(message = 'mcp token introspection failed') {
    super(message);
    this.name = 'IntrospectionFailedError';
  }
}

export interface IntrospectClientConfig {
  backendUrl: string | undefined;
  aiServiceToken: string | undefined;
  mcpTokenCacheTtlSeconds: number;
}

export interface IntrospectClient {
  introspect(rawToken: string): Promise<McpPrincipal>;
}

interface IntrospectResponseBody {
  userId: string;
  projectIds: string[];
  scopes: string[];
  actingJwt: string;
  actingJwtExpiresAt: string;
}

interface CacheEntry {
  principal: McpPrincipal;
  cachedAt: number;
}

function parsePrincipal(body: IntrospectResponseBody): McpPrincipal {
  if (
    !body ||
    typeof body.userId !== 'string' ||
    !Array.isArray(body.projectIds) ||
    !Array.isArray(body.scopes) ||
    typeof body.actingJwt !== 'string' ||
    typeof body.actingJwtExpiresAt !== 'string'
  ) {
    throw new IntrospectionFailedError('malformed introspection response');
  }

  const actingJwtExpiresAt = new Date(body.actingJwtExpiresAt);
  if (Number.isNaN(actingJwtExpiresAt.getTime())) {
    throw new IntrospectionFailedError('malformed introspection response');
  }

  return {
    userId: body.userId,
    projectIds: body.projectIds,
    scopes: body.scopes,
    actingJwt: body.actingJwt,
    actingJwtExpiresAt,
  };
}

export function createIntrospectClient(
  config: IntrospectClientConfig,
): IntrospectClient {
  const cache = new Map<string, CacheEntry>();
  const ttlMs = config.mcpTokenCacheTtlSeconds * 1000;

  return {
    async introspect(rawToken: string): Promise<McpPrincipal> {
      const cached = cache.get(rawToken);
      const now = Date.now();
      if (cached && now - cached.cachedAt < ttlMs) {
        return cached.principal;
      }

      let response: Response;
      try {
        const headers = new Headers();
        headers.set('Authorization', `Bearer ${config.aiServiceToken}`);
        headers.set('Content-Type', 'application/json');
        response = await fetch(
          `${config.backendUrl}/internal/mcp-tokens/introspect`,
          {
            method: 'POST',
            headers,
            body: JSON.stringify({ token: rawToken }),
            redirect: 'error',
          },
        );
      } catch {
        throw new IntrospectionFailedError('introspection request failed');
      }

      if (!response.ok) {
        throw new IntrospectionFailedError(
          `introspection failed with status ${response.status}`,
        );
      }

      let body: IntrospectResponseBody;
      try {
        body = (await response.json()) as IntrospectResponseBody;
      } catch {
        throw new IntrospectionFailedError('malformed introspection response');
      }

      const principal = parsePrincipal(body);
      cache.set(rawToken, { principal, cachedAt: now });
      return principal;
    },
  };
}
