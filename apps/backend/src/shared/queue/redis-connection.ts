import type { RedisOptions } from 'bullmq';
import { isProduction } from '../security/production-config';

const DEFAULT_REDIS_URL = 'redis://localhost:6379';

export function resolveRedisConnection(): RedisOptions {
  const configured = process.env.REDIS_URL?.trim();

  if (!configured && isProduction()) {
    throw new Error('REDIS_URL obrigatório em produção');
  }

  const url = new URL(configured || DEFAULT_REDIS_URL);

  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(url.protocol === 'rediss:'
      ? { tls: { rejectUnauthorized: true } }
      : {}),
  };
}
