import type { ThrottlerStorage } from '@nestjs/throttler';
import Redis from 'ioredis';
import { resolveRedisConnection } from '../queue/redis-connection';

const incrementScript = `
local blocked = redis.call('PTTL', KEYS[2])
if blocked > 0 then return {0, 0, 1, blocked} end
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local remaining = redis.call('PTTL', KEYS[1])
if hits > tonumber(ARGV[2]) then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  return {hits, remaining, 1, tonumber(ARGV[3])}
end
return {hits, remaining, 0, 0}
`;

export class RedisThrottler implements ThrottlerStorage {
  private connecting: Promise<void> | undefined;
  private readonly redis = new Redis({
    ...resolveRedisConnection(),
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
  });

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ) {
    if (this.redis.status === 'wait') this.connecting = this.redis.connect();
    if (this.connecting) await this.connecting;
    const prefix = `cast:rate:{${throttlerName}:${key}}`;
    const values = (await this.redis.eval(
      incrementScript,
      2,
      `${prefix}:hits`,
      `${prefix}:blocked`,
      ttl,
      limit,
      Math.max(blockDuration, 1),
    )) as number[];
    return {
      totalHits: values[0],
      timeToExpire: Math.ceil(values[1] / 1000),
      isBlocked: values[2] === 1,
      timeToBlockExpire: Math.ceil(values[3] / 1000),
    };
  }

  onModuleDestroy() {
    this.redis.disconnect();
  }
}
