const DEFAULT_PORT = 3100;
const DEFAULT_TOKEN_CACHE_TTL_SECONDS = 30;
const DEFAULT_RATE_LIMIT_PER_TOKEN_PER_MIN = 60;
const DEFAULT_RATE_LIMIT_PER_IP_PER_MIN = 300;
const DEFAULT_AI_API_URL = 'http://localhost:8000';
const DEFAULT_BACKEND_URL = 'http://localhost:3000';

export interface Config {
  port: number;
  aiApiUrl: string;
  backendUrl: string;
  aiServiceToken: string | undefined;
  mcpTokenCacheTtlSeconds: number;
  rateLimitPerTokenPerMinute: number;
  rateLimitPerIpPerMinute: number;
}

function isProduction(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.APP_ENV === 'production'
  );
}

function requiredInProduction(
  name: string,
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();
  if (trimmed) return trimmed;
  if (isProduction()) {
    throw new Error(`${name} obrigatório em produção`);
  }
  return undefined;
}

export function loadConfig(): Config {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  const mcpTokenCacheTtlSeconds = Number(
    process.env.MCP_TOKEN_CACHE_TTL_SECONDS ?? DEFAULT_TOKEN_CACHE_TTL_SECONDS,
  );
  const rateLimitPerTokenPerMinute = Number(
    process.env.RATE_LIMIT_PER_TOKEN_PER_MIN ??
      DEFAULT_RATE_LIMIT_PER_TOKEN_PER_MIN,
  );
  const rateLimitPerIpPerMinute = Number(
    process.env.RATE_LIMIT_PER_IP_PER_MIN ?? DEFAULT_RATE_LIMIT_PER_IP_PER_MIN,
  );

  return {
    port,
    aiApiUrl:
      requiredInProduction('AI_API_URL', process.env.AI_API_URL) ??
      DEFAULT_AI_API_URL,
    backendUrl:
      requiredInProduction('BACKEND_URL', process.env.BACKEND_URL) ??
      DEFAULT_BACKEND_URL,
    aiServiceToken: requiredInProduction(
      'AI_SERVICE_TOKEN',
      process.env.AI_SERVICE_TOKEN,
    ),
    mcpTokenCacheTtlSeconds,
    rateLimitPerTokenPerMinute,
    rateLimitPerIpPerMinute,
  };
}
