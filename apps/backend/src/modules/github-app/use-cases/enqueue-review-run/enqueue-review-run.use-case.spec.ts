import type { GithubAppRepository } from '../../entities/github-app-repository.entity';
import type { GithubInstallation } from '../../entities/github-installation.entity';
import { EnqueueReviewRunUseCase } from './enqueue-review-run.use-case';

function installation(ownerUserId: string | null): GithubInstallation {
  return {
    id: 'inst-row',
    installationId: '4242',
    ownerUserId,
  } as GithubInstallation;
}

const repository = {
  id: 'repo-row',
  owner: 'acme',
  repo: 'back',
  fullName: 'acme/back',
  config: {},
} as unknown as GithubAppRepository;

const facts = {
  pullNumber: 7,
  headSha: 'head-sha',
  baseRef: 'main',
  owner: 'acme',
  repo: 'back',
};

function build() {
  const queue = { add: jest.fn(), getJob: jest.fn() };
  const reviewRunRepository = {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    create: jest.fn((row: unknown) => row),
    save: jest.fn(async (row: { id: string }) => row),
    update: jest.fn(),
  };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
  return {
    queue,
    logger,
    useCase: new EnqueueReviewRunUseCase(
      reviewRunRepository as never,
      queue as never,
      logger as never,
    ),
  };
}

const input = (ownerUserId: string | null) => ({
  installation: installation(ownerUserId),
  repository,
  facts,
  trigger: 'webhook' as const,
  eventAction: 'opened',
  deliveryId: 'delivery-1',
});

describe('EnqueueReviewRunUseCase', () => {
  it('carries the installation owner into the job so the worker has an RLS actor', async () => {
    const { useCase, queue } = build();

    const outcome = await useCase.execute(input('user-1'));

    expect(outcome.status).toBe('queued');
    const [, jobData] = queue.add.mock.calls[0];
    expect(jobData.actorUserId).toBe('user-1');
  });

  it('skips an installation with no linked owner instead of queueing a job it cannot scope', async () => {
    const { useCase, queue, logger } = build();

    const outcome = await useCase.execute(input(null));

    // `skipped/configuration_required`, nunca `duplicate`: duplicata é
    // resultado normal e esconderia uma App instalada sem vínculo revisando
    // nada em silêncio.
    expect(outcome).toEqual({
      status: 'skipped',
      reason: 'configuration_required',
    });
    expect(queue.add).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });
});
