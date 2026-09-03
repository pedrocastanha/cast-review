import { defaultRepositoryConfig } from '../../domain/github-app.types';
import { computeWebhookSignature } from '../../infrastructure/github/security/webhook-signature';
import { EnqueueReviewRunUseCase } from '../enqueue-review-run/enqueue-review-run.use-case';
import { HandleWebhookUseCase } from './handle-webhook.use-case';

const SECRET = 'segredo-webhook';

function pullPayload(overrides: Record<string, unknown> = {}) {
  return {
    action: 'synchronize',
    installation: { id: 42 },
    repository: {
      id: 100,
      name: 'api',
      full_name: 'octo-org/api',
      owner: { login: 'octo-org' },
    },
    pull_request: {
      number: 7,
      state: 'open',
      draft: false,
      head: { sha: 'sha-a', ref: 'feature' },
      base: { sha: 'sha-base', ref: 'main' },
    },
    ...overrides,
  };
}

function installationRow(overrides = {}) {
  return {
    id: 'inst-row',
    installationId: '42',
    ownerUserId: 'user-1',
    status: 'active',
    pausedAt: null,
    ...overrides,
  };
}

function repositoryRow(overrides = {}) {
  return {
    id: 'repo-row',
    installationId: 'inst-row',
    githubRepoId: '100',
    owner: 'octo-org',
    repo: 'api',
    fullName: 'octo-org/api',
    enabled: true,
    configStatus: 'ready',
    pausedAt: null,
    removedAt: null,
    config: {
      ...defaultRepositoryConfig(),
      models: {
        testReviewer: 'gpt-5.4-mini',
        architectureReviewer: 'gpt-5.4-mini',
      },
      budgetMonthlyUsd: 10,
    },
    ...overrides,
  };
}

function build(
  options: {
    installation?: unknown;
    repository?: unknown;
    existingDelivery?: unknown;
    duplicateRun?: unknown;
    openRuns?: unknown[];
  } = {},
) {
  const savedDeliveries: any[] = [];
  const savedRuns: any[] = [];
  const deliveryRepository = {
    findOne: jest.fn().mockResolvedValue(options.existingDelivery ?? null),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => {
      savedDeliveries.push(value);
      return value;
    }),
    update: jest.fn().mockResolvedValue(undefined),
    createQueryBuilder: jest.fn(() => ({
      update: () => ({
        set: () => ({
          where: () => ({ andWhere: () => ({ execute: jest.fn() }) }),
        }),
      }),
    })),
  };
  const installationRepository = {
    findOne: jest.fn().mockResolvedValue(options.installation ?? null),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const appRepositoryRepository = {
    findOne: jest.fn().mockResolvedValue(options.repository ?? null),
  };
  const reviewRunRepository = {
    findOne: jest.fn().mockResolvedValue(options.duplicateRun ?? null),
    find: jest.fn().mockResolvedValue(options.openRuns ?? []),
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => {
      savedRuns.push(value);
      return value;
    }),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const syncRepositories = { execute: jest.fn() };
  const tokenService = { forget: jest.fn() };
  const reviewQueue = {
    add: jest.fn().mockResolvedValue(undefined),
    getJob: jest.fn().mockResolvedValue(null),
  };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  const enqueueReviewRun = new EnqueueReviewRunUseCase(
    reviewRunRepository as any,
    reviewQueue as any,
    logger as any,
  );
  const service = new HandleWebhookUseCase(
    deliveryRepository as any,
    installationRepository as any,
    appRepositoryRepository as any,
    enqueueReviewRun,
    syncRepositories as any,
    tokenService as any,
    logger as any,
  );

  return {
    service,
    deliveryRepository,
    installationRepository,
    reviewRunRepository,
    reviewQueue,
    tokenService,
    savedRuns,
    savedDeliveries,
    logger,
  };
}

function envelope(payload: Record<string, unknown>, deliveryId = 'delivery-1') {
  const rawBody = Buffer.from(JSON.stringify(payload));
  return {
    deliveryId,
    event: 'pull_request',
    signature: computeWebhookSignature(SECRET, rawBody),
    rawBody,
    payload,
  };
}

describe('HandleWebhookUseCase.execute', () => {
  const previousSecret = process.env.GITHUB_APP_WEBHOOK_SECRET;

  beforeAll(() => {
    process.env.GITHUB_APP_WEBHOOK_SECRET = SECRET;
  });

  afterAll(() => {
    process.env.GITHUB_APP_WEBHOOK_SECRET = previousSecret;
  });

  it('rejects an unsigned delivery before persisting anything', async () => {
    const { service, deliveryRepository } = build();
    const payload = pullPayload();

    const outcome = await service.execute({
      deliveryId: 'delivery-1',
      event: 'pull_request',
      signature: 'sha256=falsa',
      rawBody: Buffer.from(JSON.stringify(payload)),
      payload,
    });

    expect(outcome).toEqual({ status: 'invalid_signature' });
    expect(deliveryRepository.save).not.toHaveBeenCalled();
  });

  it('queues one review run for an eligible synchronize', async () => {
    const { service, savedRuns, reviewQueue } = build({
      installation: installationRow(),
      repository: repositoryRow(),
    });

    const outcome = await service.execute(envelope(pullPayload()));

    expect(outcome.status).toBe('queued');
    expect(savedRuns).toHaveLength(1);
    expect(savedRuns[0]).toMatchObject({
      pullNumber: 7,
      headSha: 'sha-a',
      status: 'queued',
      trigger: 'webhook',
      eventAction: 'synchronize',
    });
    expect(reviewQueue.add).toHaveBeenCalledTimes(1);
  });

  it('treats a GitHub redelivery of the same delivery id as a duplicate', async () => {
    const { service, reviewQueue } = build({
      existingDelivery: { deliveryId: 'delivery-1', reviewRunId: 'run-1' },
    });

    const outcome = await service.execute(envelope(pullPayload()));

    expect(outcome).toEqual({ status: 'duplicate', reviewRunId: 'run-1' });
    expect(reviewQueue.add).not.toHaveBeenCalled();
  });

  it('does not create a second logical run for the same repo, PR, SHA and config', async () => {
    const { service, reviewQueue, savedRuns } = build({
      installation: installationRow(),
      repository: repositoryRow(),
      duplicateRun: { id: 'run-existing' },
    });

    const outcome = await service.execute(
      envelope(pullPayload(), 'delivery-outra'),
    );

    expect(outcome).toEqual({
      status: 'duplicate',
      reviewRunId: 'run-existing',
    });
    expect(savedRuns).toHaveLength(0);
    expect(reviewQueue.add).not.toHaveBeenCalled();
  });

  it('supersedes the in-flight run of the same pull request when a new SHA arrives', async () => {
    const waitingJob = {
      getState: jest.fn().mockResolvedValue('waiting'),
      remove: jest.fn(),
    };
    const { service, reviewRunRepository, reviewQueue } = build({
      installation: installationRow(),
      repository: repositoryRow(),
      openRuns: [{ id: 'run-antigo', headSha: 'sha-a' }],
    });
    reviewQueue.getJob.mockResolvedValue(waitingJob);

    const payload = pullPayload();
    (payload.pull_request as Record<string, unknown>).head = {
      sha: 'sha-b',
      ref: 'feature',
    };

    const outcome = await service.execute(envelope(payload, 'delivery-2'));

    expect(outcome.status).toBe('queued');
    expect(reviewRunRepository.update).toHaveBeenCalledWith(
      'run-antigo',
      expect.objectContaining({
        status: 'superseded',
        skipReason: 'superseded',
      }),
    );
    expect(waitingJob.remove).toHaveBeenCalled();
  });

  it('does not cancel a run that is already executing in the worker', async () => {
    const activeJob = {
      getState: jest.fn().mockResolvedValue('active'),
      remove: jest.fn(),
    };
    const { service, reviewQueue, reviewRunRepository } = build({
      installation: installationRow(),
      repository: repositoryRow(),
      openRuns: [{ id: 'run-ativo', headSha: 'sha-a' }],
    });
    reviewQueue.getJob.mockResolvedValue(activeJob);

    const payload = pullPayload();
    (payload.pull_request as Record<string, unknown>).head = {
      sha: 'sha-b',
      ref: 'feature',
    };
    await service.execute(envelope(payload, 'delivery-3'));

    expect(activeJob.remove).not.toHaveBeenCalled();

    expect(reviewRunRepository.update).toHaveBeenCalledWith(
      'run-ativo',
      expect.objectContaining({ status: 'superseded' }),
    );
  });

  it('skips a repository whose automation is off', async () => {
    const { service, reviewQueue } = build({
      installation: installationRow(),
      repository: repositoryRow({ enabled: false }),
    });

    const outcome = await service.execute(envelope(pullPayload()));

    expect(outcome).toEqual({
      status: 'skipped',
      reason: 'automation_disabled',
    });
    expect(reviewQueue.add).not.toHaveBeenCalled();
  });

  it('skips every repository of a paused installation', async () => {
    const { service, reviewQueue } = build({
      installation: installationRow({ pausedAt: new Date() }),
      repository: repositoryRow(),
    });

    const outcome = await service.execute(envelope(pullPayload()));

    expect(outcome).toEqual({
      status: 'skipped',
      reason: 'installation_paused',
    });
    expect(reviewQueue.add).not.toHaveBeenCalled();
  });

  it('ignores an installation that was never linked to a Cast user', async () => {
    const { service, reviewQueue } = build({
      installation: installationRow({ ownerUserId: null }),
      repository: repositoryRow(),
    });

    const outcome = await service.execute(envelope(pullPayload()));

    expect(outcome).toEqual({
      status: 'skipped',
      reason: 'installation_inactive',
    });
    expect(reviewQueue.add).not.toHaveBeenCalled();
  });

  it('marks open runs as superseded when the pull request closes', async () => {
    const { service, reviewRunRepository, reviewQueue } = build({
      installation: installationRow(),
      repository: repositoryRow(),
      openRuns: [{ id: 'run-aberto', headSha: 'sha-a' }],
    });

    const outcome = await service.execute(
      envelope(pullPayload({ action: 'closed' }), 'delivery-close'),
    );

    expect(outcome).toEqual({
      status: 'ignored',
      reason: 'pull request fechada',
    });
    expect(reviewRunRepository.update).toHaveBeenCalledWith(
      'run-aberto',
      expect.objectContaining({
        status: 'superseded',
        skipReason: 'pull_closed',
      }),
    );
    expect(reviewQueue.add).not.toHaveBeenCalled();
  });

  it('forgets cached installation tokens when the installation is suspended', async () => {
    const { service, tokenService, installationRepository } = build({
      installation: installationRow(),
    });
    const payload = { action: 'suspend', installation: { id: 42 } };
    const rawBody = Buffer.from(JSON.stringify(payload));

    await service.execute({
      deliveryId: 'delivery-suspend',
      event: 'installation',
      signature: computeWebhookSignature(SECRET, rawBody),
      rawBody,
      payload,
    });

    expect(installationRepository.update).toHaveBeenCalledWith(
      'inst-row',
      expect.objectContaining({ status: 'suspended' }),
    );
    expect(tokenService.forget).toHaveBeenCalledWith('42');
  });

  it('records every delivery for audit, including the ignored ones', async () => {
    const { service, savedDeliveries, deliveryRepository } = build({
      installation: installationRow(),
      repository: repositoryRow({ enabled: false }),
    });

    await service.execute(envelope(pullPayload()));

    expect(savedDeliveries[0]).toMatchObject({
      deliveryId: 'delivery-1',
      event: 'pull_request',
      action: 'synchronize',
      installationId: '42',
      repositoryFullName: 'octo-org/api',
      pullNumber: 7,
      headSha: 'sha-a',
    });
    expect(deliveryRepository.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        status: 'ignored',
        reason: 'automation_disabled',
      }),
    );
  });
});
