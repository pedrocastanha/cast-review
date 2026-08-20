/**
 * Testa a fila `code-index` de verdade (Redis real do `docker-compose.yml`) — unit
 * tests já cobrem `IndexProcessor`/`enqueueIndexJob` com tudo mockado; isso aqui
 * valida o que só dá pra provar com BullMQ de verdade: dedupe por `jobId`, conexão
 * funcionando. Ver TESTING.md "backend integration (BullMQ)".
 */
import { BullModule, getQueueToken } from '@nestjs/bullmq';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { resolveRedisConnection } from 'src/shared/queue/redis-connection';
import { buildIndexJobId, CODE_INDEX_QUEUE, IndexJobData } from './index-queue.constants';

describe('code-index queue (real Redis)', () => {
  let module: TestingModule;
  let queue: Queue<IndexJobData>;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        BullModule.forRoot({ connection: resolveRedisConnection() }),
        BullModule.registerQueue({ name: CODE_INDEX_QUEUE }),
      ],
    }).compile();

    queue = module.get(getQueueToken(CODE_INDEX_QUEUE));
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await module.close();
  });

  it('deduplicates a second add() with the same jobId while the first still exists', async () => {
    const jobId = buildIndexJobId('octocat', `dedupe-test-${Date.now()}`, 'sha1');
    const data: IndexJobData = {
      owner: 'octocat',
      repo: 'dedupe-test',
      sha: 'sha1',
      userId: 'user-1',
    };

    const first = await queue.add('build', data, { jobId });
    const second = await queue.add(
      'build',
      { ...data, sha: 'sha-should-be-ignored' },
      { jobId },
    );

    expect(first.id).toBe(jobId);
    expect(second.id).toBe(jobId);
    // BullMQ retorna o job já existente em vez de criar um novo — os dados
    // continuam sendo os do primeiro `add()`, não do segundo.
    const stored = await queue.getJob(jobId);
    expect(stored?.data.sha).toBe('sha1');

    await stored?.remove();
  });

  it('allows re-adding the same jobId after the previous job was removed', async () => {
    const jobId = buildIndexJobId('octocat', `readd-test-${Date.now()}`, 'sha1');
    const data: IndexJobData = {
      owner: 'octocat',
      repo: 'readd-test',
      sha: 'sha1',
      userId: 'user-1',
    };

    const first = await queue.add('build', data, { jobId });
    await first.remove();

    const second = await queue.add('build', data, { jobId });
    expect(second.id).toBe(jobId);

    await second.remove();
  });
});
