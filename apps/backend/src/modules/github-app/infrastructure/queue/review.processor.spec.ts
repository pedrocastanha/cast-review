import type { AnalysisReview } from '../../../analyses/analyses.types';
import { defaultRepositoryConfig } from '../../domain/github-app.types';
import { ReviewProcessor } from './review.processor';

jest.mock('../github/installation-github.gateway', () => ({
  InstallationGithubGateway: jest.fn().mockImplementation(() => ({
    getPullHeadSha: jest.fn().mockResolvedValue('sha-a'),
  })),
}));

import { InstallationGithubGateway } from '../github/installation-github.gateway';

function reviewRun(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-1',
    installationId: 'inst-row',
    repositoryId: 'repo-row',
    githubInstallationId: '42',
    owner: 'octo-org',
    repo: 'api',
    pullNumber: 7,
    headSha: 'sha-a',
    baseRef: 'main',
    status: 'queued',
    attempts: 0,
    startedAt: null,
    checkRun: null,
    analysisId: null,
    ...overrides,
  };
}

function review(overrides: Partial<AnalysisReview> = {}): AnalysisReview {
  return {
    results: [],
    comments: [],
    verdict: 'comment',
    overallScore: 80,
    failCount: 0,
    warningCount: 1,
    usage: {
      currency: 'USD',
      promptTokens: 10,
      cachedTokens: 0,
      completionTokens: 5,
      totalTokens: 15,
      costUsd: 0.02,
      costComplete: true,
      pricingAsOf: '2026-09-01',
      steps: [],
    },
    ...overrides,
  };
}

function build(
  options: {
    run?: Record<string, unknown>;
    runAfter?: Record<string, unknown>;
    installation?: Record<string, unknown> | null;
    repository?: Record<string, unknown> | null;
    reserve?: boolean;
    openaiKey?: string | null;
    headless?: unknown;
  } = {},
) {
  const stored = options.run ?? reviewRun();
  const reviewRunRepository = {
    findOne: jest
      .fn()
      .mockResolvedValueOnce(stored)
      .mockResolvedValue(options.runAfter ?? stored),
    update: jest.fn().mockResolvedValue(undefined),
  };
  const installationRepository = {
    findOne: jest.fn().mockResolvedValue(
      options.installation === undefined
        ? {
            id: 'inst-row',
            installationId: '42',
            ownerUserId: 'user-1',
            status: 'active',
            pausedAt: null,
          }
        : options.installation,
    ),
  };
  const appRepositoryRepository = {
    findOne: jest.fn().mockResolvedValue(
      options.repository === undefined
        ? {
            id: 'repo-row',
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
          }
        : options.repository,
    ),
  };
  const analysesService = {
    runHeadless: jest.fn().mockResolvedValue(
      options.headless ?? {
        analysis: { id: 'analysis-1', status: 'completed', errorMessage: null },
        review: review(),
      },
    ),
  };
  const projectsService = { resolveAnalysisScope: jest.fn() };
  const userService = {
    getOpenaiKey:
      options.openaiKey === null
        ? jest.fn().mockRejectedValue(new Error('sem chave'))
        : jest.fn().mockResolvedValue(options.openaiKey ?? 'sk-teste'),
  };
  const tokenService = { clientFor: jest.fn(), forget: jest.fn() };
  const checkRunService = {
    create: jest.fn().mockResolvedValue({
      id: 900,
      status: 'in_progress',
      conclusion: null,
      htmlUrl: 'https://github.com/check/900',
    }),
    update: jest.fn().mockResolvedValue(null),
  };
  const githubAppService = {
    budgetReservationFor: jest.fn().mockReturnValue(0.5),
    reserveBudget: jest.fn().mockResolvedValue(options.reserve ?? true),
    settleBudget: jest.fn().mockResolvedValue(undefined),
  };
  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  const processor = new ReviewProcessor(
    reviewRunRepository as any,
    installationRepository as any,
    appRepositoryRepository as any,
    analysesService as any,
    projectsService as any,
    userService as any,
    tokenService as any,
    checkRunService as any,
    githubAppService as any,
    logger as any,
  );

  return {
    processor,
    reviewRunRepository,
    analysesService,
    checkRunService,
    githubAppService,
    userService,
    logger,
  };
}

const job = (reviewRunId = 'run-1') => ({ data: { reviewRunId } }) as never;

describe('ReviewProcessor.process', () => {
  beforeEach(() => {
    (InstallationGithubGateway as unknown as jest.Mock).mockImplementation(
      () => ({
        getPullHeadSha: jest.fn().mockResolvedValue('sha-a'),
      }),
    );
  });

  it('opens the check run as in_progress before spending anything on the LLM', async () => {
    const { processor, checkRunService, githubAppService } = build();
    await processor.process(job());

    expect(checkRunService.create).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'in_progress', headSha: 'sha-a' }),
    );
    expect(checkRunService.create.mock.invocationCallOrder[0]).toBeLessThan(
      githubAppService.reserveBudget.mock.invocationCallOrder[0],
    );
  });

  it('completes the check as neutral for an informative verdict', async () => {
    const { processor, checkRunService, reviewRunRepository } = build();
    await processor.process(job());

    expect(checkRunService.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'completed', conclusion: 'neutral' }),
    );
    expect(reviewRunRepository.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'completed',
        analysisId: 'analysis-1',
      }),
    );
  });

  it('concludes success only when the reviewers approved', async () => {
    const { processor, checkRunService } = build({
      headless: {
        analysis: { id: 'analysis-1', status: 'completed', errorMessage: null },
        review: review({ verdict: 'approve' }),
      },
    });
    await processor.process(job());

    expect(checkRunService.update).toHaveBeenCalledWith(
      expect.objectContaining({ conclusion: 'success' }),
    );
  });

  it('skips the analysis when the monthly budget is exhausted', async () => {
    const { processor, analysesService, reviewRunRepository, checkRunService } =
      build({
        reserve: false,
      });
    await processor.process(job());

    expect(analysesService.runHeadless).not.toHaveBeenCalled();
    expect(reviewRunRepository.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'skipped',
        skipReason: 'budget_exceeded',
      }),
    );
    expect(checkRunService.update).toHaveBeenCalledWith(
      expect.objectContaining({ conclusion: 'neutral' }),
    );
  });

  it('does not retry forever when the OpenAI key is missing: it asks for configuration', async () => {
    const { processor, analysesService, reviewRunRepository } = build({
      openaiKey: null,
    });
    await processor.process(job());

    expect(analysesService.runHeadless).not.toHaveBeenCalled();
    expect(reviewRunRepository.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'skipped',
        skipReason: 'configuration_required',
      }),
    );
  });

  it('never publishes a result whose SHA is no longer the head of the pull request', async () => {
    (InstallationGithubGateway as unknown as jest.Mock).mockImplementation(
      () => ({
        getPullHeadSha: jest.fn().mockResolvedValue('sha-b'),
      }),
    );
    const { processor, reviewRunRepository, checkRunService } = build();

    await processor.process(job());

    expect(reviewRunRepository.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'superseded',
        skipReason: 'superseded',
      }),
    );
    expect(checkRunService.update).toHaveBeenCalledWith(
      expect.objectContaining({
        output: expect.objectContaining({ title: 'Superada por novo push' }),
      }),
    );
  });

  it('blocks the GitHub publication when the head moved mid-analysis', async () => {
    (InstallationGithubGateway as unknown as jest.Mock).mockImplementation(
      () => ({
        getPullHeadSha: jest.fn().mockResolvedValue('sha-b'),
      }),
    );
    const { processor, analysesService } = build();
    await processor.process(job());

    const gate = analysesService.runHeadless.mock.calls[0][0].beforePublish;
    await expect(gate()).resolves.toEqual({
      allowed: false,
      reason: 'Head da PR mudou para sha-b',
    });
  });

  it('allows publication while the analysed SHA is still the head', async () => {
    const { processor, analysesService } = build();
    await processor.process(job());

    const gate = analysesService.runHeadless.mock.calls[0][0].beforePublish;
    await expect(gate()).resolves.toEqual({ allowed: true });
  });

  it('publishes comments only when the repository opted into them', async () => {
    const { processor, analysesService } = build();
    await processor.process(job());
    expect(analysesService.runHeadless.mock.calls[0][0].publishPolicy).toEqual({
      prd: 'auto',
      spec: 'auto',
      publish: 'none',
    });
  });

  it('turns a pipeline error into a failure check without hiding the report', async () => {
    const { processor, checkRunService, reviewRunRepository } = build({
      headless: {
        analysis: {
          id: 'analysis-1',
          status: 'error',
          errorMessage: 'ai-api fora do ar',
        },
        review: review(),
      },
    });
    await processor.process(job());

    expect(reviewRunRepository.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'ai-api fora do ar',
      }),
    );
    expect(checkRunService.update).toHaveBeenCalledWith(
      expect.objectContaining({ conclusion: 'failure' }),
    );
  });

  it('ignores a job whose run already reached a terminal state', async () => {
    const { processor, checkRunService, analysesService } = build({
      run: reviewRun({ status: 'superseded' }),
    });
    await processor.process(job());

    expect(checkRunService.create).not.toHaveBeenCalled();
    expect(analysesService.runHeadless).not.toHaveBeenCalled();
  });

  it('stops before any GitHub call when the installation was paused after enqueueing', async () => {
    const { processor, checkRunService, reviewRunRepository } = build({
      installation: {
        id: 'inst-row',
        installationId: '42',
        ownerUserId: 'user-1',
        status: 'active',
        pausedAt: new Date(),
      },
    });
    await processor.process(job());

    expect(checkRunService.create).not.toHaveBeenCalled();
    expect(reviewRunRepository.update).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({
        status: 'skipped',
        skipReason: 'installation_paused',
      }),
    );
  });

  it('settles the real cost reported by the analysis', async () => {
    const { processor, githubAppService } = build();
    await processor.process(job());
    expect(githubAppService.settleBudget).toHaveBeenCalledWith('run-1', 0.02);
  });
});
