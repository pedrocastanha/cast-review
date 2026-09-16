import type { Request } from 'express';
import { type RateLimitRequestHandler, rateLimit } from 'express-rate-limit';
import type { Config } from './config';

const ANONYMOUS_TOKEN_KEY = 'anonymous';
const WINDOW_MS = 60_000;

function extractToken(req: Request): string {
  const header = req.headers.authorization;
  if (!header) return ANONYMOUS_TOKEN_KEY;

  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() === 'bearer' && token) return token;

  return ANONYMOUS_TOKEN_KEY;
}

export function createMcpRateLimiters(
  config: Pick<
    Config,
    'rateLimitPerTokenPerMinute' | 'rateLimitPerIpPerMinute'
  >,
): RateLimitRequestHandler[] {
  const perTokenLimiter = rateLimit({
    windowMs: WINDOW_MS,
    limit: config.rateLimitPerTokenPerMinute,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: extractToken,
    handler: (_req, res) => {
      res.status(429).json({ error: 'rate limit exceeded' });
    },
  });

  const perIpLimiter = rateLimit({
    windowMs: WINDOW_MS,
    limit: config.rateLimitPerIpPerMinute,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: 'rate limit exceeded' });
    },
  });

  return [perTokenLimiter, perIpLimiter];
}
