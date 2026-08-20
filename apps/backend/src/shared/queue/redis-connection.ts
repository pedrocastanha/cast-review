import type { RedisOptions } from 'bullmq';

const DEFAULT_REDIS_URL = 'redis://localhost:6379';

export function resolveRedisConnection(): RedisOptions {
  const url = new URL(process.env.REDIS_URL?.trim() || DEFAULT_REDIS_URL);

  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.password ? { password: url.password } : {}),
  };
}
