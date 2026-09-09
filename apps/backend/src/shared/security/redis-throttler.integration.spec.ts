import { randomUUID } from 'node:crypto';
import { RedisThrottler } from './redis-throttler';

describe('distributed rate limits', () => {
  it('shares an atomic counter across service instances', async () => {
    const first = new RedisThrottler();
    const second = new RedisThrottler();
    try {
      const key = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          (index % 2 ? first : second).increment(
            key,
            5000,
            5,
            5000,
            'security-test',
          ),
        ),
      );
      expect(results.filter((result) => !result.isBlocked)).toHaveLength(5);
      expect(results.filter((result) => result.isBlocked)).toHaveLength(5);
    } finally {
      first.onModuleDestroy();
      second.onModuleDestroy();
    }
  });
});
