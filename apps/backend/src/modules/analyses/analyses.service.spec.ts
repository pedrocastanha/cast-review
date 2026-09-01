import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AgentEvent } from 'src/shared/types';
import type { PublishPolicy } from './analyses.types';
import { Analysis } from './analysis.entity';

// `RepositoriesService` pulls in `@octokit/rest`, which is ESM-only and not
// covered by this project's `transformIgnorePatterns` (a pre-existing gap —
// no `*.service.spec.ts` file exercised this import path before). Providing
// an explicit factory here avoids ever loading the real module (and its
// octokit chain), instead of touching the shared jest config.
jest.mock('../repositories/repositories.service', () => ({
  RepositoriesService: jest.fn(),
}));

import { AnalysesService } from './analyses.service';

function fakeResponse(): { res: Response; writes: string[] } {
  const writes: string[] = [];
  const res = {
    write: jest.fn((chunk: string) => {
      writes.push(chunk);
      return true;
    }),
    end: jest.fn(),
    writeHead: jest.fn(),
    flushHeaders: jest.fn(),
    json: jest.fn(),
  } as unknown as Response;
  return { res, writes };
}

function fakeRequest(): Request {
  return { on: jest.fn() } as unknown as Request;
}

function eventsOf(writes: string[]): AgentEvent[] {
  return writes.map(
    (raw) => JSON.parse(raw.replace(/^data: /, '').trim()) as AgentEvent,
  );
}

function fakeAnalysis(overrides: Partial<Analysis> = {}): Analysis {
  // Plain object, not `new Analysis(...)`: under this project's tsconfig
  // (target ES2023, so `useDefineForClassFields` defaults on), TypeScript
  // emits subclass field declarations without an initializer (e.g.
  // `publishPolicy: PublishPolicy | null;`) as an own-property define that
  // runs *after* `DefaultEntity`'s constructor — silently wiping whatever
  // `Object.assign(this, data)` just set. A plain literal sidesteps that
  // pre-existing footgun entirely; streamLeg only reads properties, so a
  // real entity instance isn't needed.
  return {
    id: 'analysis-1',
    requestedBy: 'user-1',
    owner: 'octo-org',
    repo: 'octo-repo',
    pullNumber: 7,
    status: 'running',
    report: null,
    thoughts: {},
    errorMessage: null,
    models: { testReviewer: 'gpt-4', architectureReviewer: 'gpt-4' },
    impactScope: null,
    finishedAt: null,
    approvalStage: null,
    publishPolicy: null,
    prdIterations: [],
    specIterations: [],
    resumedCount: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Analysis;
}

async function* scripted(events: AgentEvent[]): AsyncGenerator<AgentEvent> {
  for (const event of events) {
    yield event;
  }
}

async function* throwing(message: string): AsyncGenerator<AgentEvent> {
  throw new Error(message);
  // biome-ignore lint/correctness/noUnreachable: see above.
  yield { type: 'thought', payload: {} };
}

function buildService() {
  const analysisRepository = {
    update: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn(),
  };
  const repositoriesService = {
    listPullFiles: jest.fn(),
    getPullHeadSha: jest.fn(),
    loginFor: jest.fn(),
    listPullReviewComments: jest.fn(),
    deletePullReviewComment: jest.fn(),
    createPullReview: jest.fn(),
  };
  const aiApiClient = { resumeAgent: jest.fn() };
  const logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };
  const contextSnapshotRepository = {
    create: jest.fn((value) => value),
    save: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn(),
  };
  const projectsService = { resolveAnalysisScope: jest.fn() };
  const findingLifecycleService = {
    reconcile: jest.fn().mockResolvedValue({
      summary: {
        status: 'available',
        baselineAnalysisId: null,
        modelChanged: false,
        newCount: 0,
        recurringCount: 0,
        reopenedCount: 0,
        notObservedCount: 0,
        acknowledgedCount: 0,
        suppressedFromGithubCount: 0,
      },
      metadataByCommentIndex: new Map(),
    }),
    currentDispositions: jest.fn().mockResolvedValue(new Map()),
  };

  const userService = { getOpenaiKey: jest.fn(async () => 'sk-do-banco') };
  const findingCaseRepository = {};
  const findingOccurrenceRepository = {};
  const findingCaseEventRepository = {};
  const service = new AnalysesService(
    repositoriesService as any,
    aiApiClient as any,
    analysisRepository as any,
    contextSnapshotRepository as any,
    findingCaseRepository as any,
    findingOccurrenceRepository as any,
    findingCaseEventRepository as any,
    projectsService as any,
    userService as any,
    logger as any,
  );
  (service as any).findingLifecycleUseCase = findingLifecycleService;

  return {
    service,
    repositoriesService,
    userService,
    analysisRepository,
    aiApiClient,
    contextSnapshotRepository,
    findingLifecycleService,
    logger,
  };
}

function publishPolicy(publish: PublishPolicy['publish']): PublishPolicy {
  return { prd: 'manual', spec: 'manual', publish };
}

describe('AnalysesService#streamLeg', () => {
  it('persists the immutable graph snapshot emitted by change_analysis_done', async () => {
    const { service, contextSnapshotRepository } = buildService();
    const analysis = fakeAnalysis();
    const { res } = fakeResponse();
    const graphSnapshot = {
      schemaVersion: '1',
      snapshotHash: 'sha256-context',
      selected: { nodes: [] },
    };

    await (service as any).streamLeg(
      analysis,
      scripted([
        {
          type: 'change_analysis_done',
          payload: {
            files: [],
            hasTests: false,
            hasMigration: false,
            graphSnapshot,
          },
        },
      ]),
      res,
    );

    expect(contextSnapshotRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: analysis.id,
        schemaVersion: '1',
        snapshotHash: 'sha256-context',
        graphSnapshot,
      }),
    );
  });

  it('keeps the review running when snapshot persistence fails', async () => {
    const { service, contextSnapshotRepository, analysisRepository, logger } =
      buildService();
    const analysis = fakeAnalysis();
    const { res, writes } = fakeResponse();
    contextSnapshotRepository.save.mockRejectedValue(new Error('disk full'));

    await (service as any).streamLeg(
      analysis,
      scripted([
        {
          type: 'change_analysis_done',
          payload: {
            files: [],
            graphSnapshot: { schemaVersion: '1', snapshotHash: 'hash' },
          },
        },
      ]),
      res,
    );

    expect(analysisRepository.update).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'Falha ao persistir snapshot de contexto',
      expect.objectContaining({ analysisId: analysis.id }),
    );
    expect(eventsOf(writes)[0].type).toBe('change_analysis_done');
  });
  it('prd awaiting_approval persists status/stage and stops the leg without processing further events', async () => {
    const { service, analysisRepository } = buildService();
    const analysis = fakeAnalysis();
    const { res, writes } = fakeResponse();

    const events = scripted([
      { type: 'awaiting_approval', payload: { stage: 'prd' } },
      { type: 'thought', payload: { step: 'prd', delta: 'should never run' } },
    ]);

    await (service as any).streamLeg(analysis, events, res);

    expect(analysisRepository.update).toHaveBeenCalledTimes(1);
    expect(analysisRepository.update).toHaveBeenCalledWith(
      'analysis-1',
      expect.objectContaining({
        status: 'awaiting_approval',
        approvalStage: 'prd',
      }),
    );
    expect(eventsOf(writes)).toEqual([
      { type: 'awaiting_approval', payload: { stage: 'prd' } },
    ]);
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('spec awaiting_approval persists status/stage and stops the leg', async () => {
    const { service, analysisRepository } = buildService();
    const analysis = fakeAnalysis();
    const { res, writes } = fakeResponse();

    const events = scripted([
      { type: 'awaiting_approval', payload: { stage: 'spec' } },
      { type: 'thought', payload: { step: 'spec', delta: 'should never run' } },
    ]);

    await (service as any).streamLeg(analysis, events, res);

    expect(analysisRepository.update).toHaveBeenCalledTimes(1);
    expect(analysisRepository.update).toHaveBeenCalledWith(
      'analysis-1',
      expect.objectContaining({
        status: 'awaiting_approval',
        approvalStage: 'spec',
      }),
    );
    expect(eventsOf(writes)).toEqual([
      { type: 'awaiting_approval', payload: { stage: 'spec' } },
    ]);
  });

  it('manual publish policy: report_ready does NOT auto-publish, pauses for approval instead', async () => {
    const { service, analysisRepository } = buildService();
    const analysis = fakeAnalysis({ publishPolicy: publishPolicy('manual') });
    const { res, writes } = fakeResponse();
    const publishSpy = jest.spyOn(service as any, 'publishGithubComments');

    const events = scripted([
      { type: 'report_ready', payload: { results: [], markdown: 'ok' } },
    ]);

    await (service as any).streamLeg(analysis, events, res);

    expect(publishSpy).not.toHaveBeenCalled();
    expect(analysisRepository.update).toHaveBeenLastCalledWith(
      'analysis-1',
      expect.objectContaining({
        status: 'awaiting_approval',
        approvalStage: 'publish',
      }),
    );

    const emitted = eventsOf(writes);
    expect(emitted[0].type).toBe('report_ready');
    expect(emitted[1].type).toBe('finding_lifecycle_done');
    expect(emitted[2]).toEqual({
      type: 'awaiting_approval',
      payload: { stage: 'publish' },
    });
    expect(emitted).toHaveLength(3);
  });

  it('auto_safe publish policy fails closed (no guardrail signal wired yet) and behaves like manual', async () => {
    const { service, analysisRepository } = buildService();
    const analysis = fakeAnalysis({
      publishPolicy: publishPolicy('auto_safe'),
    });
    const { res, writes } = fakeResponse();
    const publishSpy = jest.spyOn(service as any, 'publishGithubComments');

    const events = scripted([
      { type: 'report_ready', payload: { results: [], markdown: 'ok' } },
    ]);

    await (service as any).streamLeg(analysis, events, res);

    expect(publishSpy).not.toHaveBeenCalled();
    expect(analysisRepository.update).toHaveBeenLastCalledWith(
      'analysis-1',
      expect.objectContaining({
        status: 'awaiting_approval',
        approvalStage: 'publish',
      }),
    );
    expect(eventsOf(writes).map((event) => event.type)).toEqual([
      'report_ready',
      'finding_lifecycle_done',
      'awaiting_approval',
    ]);
  });

  it('auto publish policy: publishes immediately exactly as before (regression)', async () => {
    const { service, analysisRepository } = buildService();
    const analysis = fakeAnalysis({ publishPolicy: publishPolicy('auto') });
    const { res, writes } = fakeResponse();
    const githubResult = {
      status: 'posted' as const,
      posted: 1,
      skipped: 0,
      reviewId: 99,
      htmlUrl: 'https://example.com/pr/1',
      errorMessage: null,
    };
    const publishSpy = jest
      .spyOn(service as any, 'publishGithubComments')
      .mockResolvedValue(githubResult);

    const events = scripted([
      { type: 'report_ready', payload: { results: [], markdown: 'ok' } },
    ]);

    await (service as any).streamLeg(analysis, events, res);

    expect(publishSpy).toHaveBeenCalledTimes(1);
    expect(analysisRepository.update).toHaveBeenCalledWith(
      'analysis-1',
      expect.objectContaining({ status: 'completed' }),
    );

    const emitted = eventsOf(writes);
    expect(emitted[0].type).toBe('report_ready');
    expect(emitted[1].type).toBe('finding_lifecycle_done');
    expect(emitted[2]).toEqual({
      type: 'github_comments_done',
      payload: githubResult,
    });
    expect(emitted).toHaveLength(3);
  });

  it('reconcilia report_ready, decora comments e persiste antes da aprovação', async () => {
    const { service, findingLifecycleService, analysisRepository } =
      buildService();
    const analysis = fakeAnalysis({ publishPolicy: publishPolicy('manual') });
    const { res, writes } = fakeResponse();
    findingLifecycleService.reconcile.mockResolvedValue({
      summary: {
        status: 'available',
        baselineAnalysisId: 'analysis-0',
        modelChanged: false,
        newCount: 1,
        recurringCount: 0,
        reopenedCount: 0,
        notObservedCount: 0,
        acknowledgedCount: 0,
        suppressedFromGithubCount: 0,
      },
      metadataByCommentIndex: new Map([
        [
          0,
          {
            caseId: 'case-1',
            classification: 'new',
            state: 'active',
            disposition: 'unreviewed',
            matchBasis: 'stable_anchor',
            firstSeenAnalysisId: 'analysis-1',
            previousOccurrenceAnalysisId: null,
          },
        ],
      ]),
    });

    await (service as any).streamLeg(
      analysis,
      scripted([
        {
          type: 'report_ready',
          payload: {
            results: [
              {
                name: 'test_reviewer',
                score: 70,
                findings: [
                  {
                    status: 'fail',
                    title: 'sem teste',
                    detail: 'x',
                    path: 'src/a.ts',
                  },
                ],
              },
            ],
          },
        },
      ]),
      res,
    );

    expect(findingLifecycleService.reconcile).toHaveBeenCalledWith(
      expect.objectContaining({ analysis, owner: 'octo-org' }),
    );
    expect(analysisRepository.update).toHaveBeenLastCalledWith(
      analysis.id,
      expect.objectContaining({
        report: expect.objectContaining({
          findingLifecycle: expect.objectContaining({ newCount: 1 }),
          comments: [
            expect.objectContaining({
              lifecycle: expect.objectContaining({ caseId: 'case-1' }),
            }),
          ],
        }),
      }),
    );
    expect(eventsOf(writes).map((item) => item.type)).toEqual([
      'report_ready',
      'finding_lifecycle_done',
      'awaiting_approval',
    ]);
  });

  it('mantém o fluxo fail-open quando a reconciliação falha', async () => {
    const { service, findingLifecycleService, analysisRepository, logger } =
      buildService();
    const analysis = fakeAnalysis({ publishPolicy: publishPolicy('manual') });
    const { res, writes } = fakeResponse();
    findingLifecycleService.reconcile.mockRejectedValue(new Error('db down'));

    await (service as any).streamLeg(
      analysis,
      scripted([
        { type: 'report_ready', payload: { results: [], markdown: 'ok' } },
      ]),
      res,
    );

    expect(analysisRepository.update).toHaveBeenLastCalledWith(
      analysis.id,
      expect.objectContaining({
        status: 'awaiting_approval',
        report: expect.objectContaining({
          findingLifecycle: expect.objectContaining({
            status: 'unavailable',
            errorCode: 'reconciliation_failed',
          }),
        }),
      }),
    );
    expect(logger.error).toHaveBeenCalledWith(
      'Falha ao reconciliar lifecycle de findings',
      expect.objectContaining({ analysisId: analysis.id }),
    );
    expect(eventsOf(writes).map((item) => item.type)).toEqual([
      'report_ready',
      'finding_lifecycle_done',
      'awaiting_approval',
    ]);
  });

  it('error event: persists error status and passes the event through unchanged (regression)', async () => {
    const { service, analysisRepository } = buildService();
    const analysis = fakeAnalysis();
    const { res, writes } = fakeResponse();

    const events = scripted([
      { type: 'error', payload: { message: 'Falha no pipeline' } },
    ]);

    await (service as any).streamLeg(analysis, events, res);

    expect(analysisRepository.update).toHaveBeenCalledWith(
      'analysis-1',
      expect.objectContaining({
        status: 'error',
        errorMessage: 'Falha no pipeline',
      }),
    );
    expect(eventsOf(writes)).toEqual([
      { type: 'error', payload: { message: 'Falha no pipeline' } },
    ]);
    expect(res.end).toHaveBeenCalledTimes(1);
  });

  it('exception thrown mid-stream: persists error status and emits a synthetic error event (regression)', async () => {
    const { service, analysisRepository, logger } = buildService();
    const analysis = fakeAnalysis();
    const { res, writes } = fakeResponse();

    await (service as any).streamLeg(analysis, throwing('network down'), res);

    expect(analysisRepository.update).toHaveBeenCalledWith(
      'analysis-1',
      expect.objectContaining({
        status: 'error',
        errorMessage: 'network down',
      }),
    );
    expect(logger.error).toHaveBeenCalled();
    expect(eventsOf(writes)).toEqual([
      { type: 'error', payload: { message: 'Falha ao rodar a análise' } },
    ]);
    expect(res.end).toHaveBeenCalledTimes(1);
  });
});

describe('AnalysesService#publishGithubComments', () => {
  it('não publica case reconhecido segundo a disposição atual do banco', async () => {
    const { service, findingLifecycleService, repositoriesService } =
      buildService();
    findingLifecycleService.currentDispositions.mockResolvedValue(
      new Map([['case-1', 'accepted_risk']]),
    );

    const result = await (service as any).publishGithubComments({
      analysisId: 'analysis-1',
      review: {
        results: [],
        comments: [
          {
            reviewer: 'test_reviewer',
            status: 'fail',
            title: 'sem teste',
            detail: 'x',
            lifecycle: {
              caseId: 'case-1',
              classification: 'recurring',
              state: 'active',
              disposition: 'unreviewed',
              matchBasis: 'stable_anchor',
              firstSeenAnalysisId: 'analysis-0',
              previousOccurrenceAnalysisId: 'analysis-0',
            },
          },
        ],
      },
      repo: 'octo-repo',
      pullNumber: 7,
      currentUser: { id: 'user-1', username: null, email: '' },
      owner: 'octo-org',
    });

    expect(findingLifecycleService.currentDispositions).toHaveBeenCalledWith(
      ['case-1'],
      'user-1',
    );
    expect(result.status).toBe('empty');
    expect(repositoriesService.listPullFiles).not.toHaveBeenCalled();
  });
});

describe('AnalysesService#resume', () => {
  const currentUser = {
    id: 'user-1',
    username: null,
    email: 'user@example.com',
  };
  const dto = {
    models: { testReviewer: 'gpt-4', architectureReviewer: 'gpt-4' },
  };

  it('happy path: owned + running analysis resumes with decision:null, increments resumedCount, and streams via streamLeg', async () => {
    const { service, analysisRepository, aiApiClient } = buildService();
    const analysis = fakeAnalysis({ resumedCount: 2 });
    analysisRepository.findOne.mockResolvedValue(analysis);
    const { res } = fakeResponse();
    const req = fakeRequest();

    const generator = scripted([
      { type: 'report_ready', payload: { results: [], markdown: 'ok' } },
    ]);
    aiApiClient.resumeAgent.mockReturnValue(generator);
    const streamLegSpy = jest
      .spyOn(service as any, 'streamLeg')
      .mockResolvedValue(undefined);

    await service.resume(analysis.id, currentUser, dto as any, req, res);

    expect(analysisRepository.findOne).toHaveBeenCalledWith({
      where: { id: analysis.id, requestedBy: currentUser.id },
    });
    expect(analysisRepository.update).toHaveBeenCalledWith(analysis.id, {
      resumedCount: 3,
    });
    expect(res.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ 'X-Analysis-Id': analysis.id }),
    );
    expect(aiApiClient.resumeAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        analysisId: analysis.id,
        models: dto.models,
        apiKeys: { openai: 'sk-do-banco' },
        policies: { prd: 'manual', spec: 'manual' },
        decision: null,
      }),
      expect.any(AbortSignal),
    );
    expect(streamLegSpy).toHaveBeenCalledWith(analysis, generator, res);
  });

  it('404s when the analysis belongs to a different user (findOne returns nothing under the ownership filter)', async () => {
    const { service, analysisRepository } = buildService();
    analysisRepository.findOne.mockResolvedValue(null);
    const { res } = fakeResponse();
    const req = fakeRequest();

    await expect(
      service.resume('analysis-1', currentUser, dto as any, req, res),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(analysisRepository.update).not.toHaveBeenCalled();
    expect(res.writeHead).not.toHaveBeenCalled();
  });

  it.each(['completed', 'awaiting_approval'] as const)(
    '409s when status is %s',
    async (status) => {
      const { service, analysisRepository } = buildService();
      const analysis = fakeAnalysis({ status });
      analysisRepository.findOne.mockResolvedValue(analysis);
      const { res } = fakeResponse();
      const req = fakeRequest();

      await expect(
        service.resume(analysis.id, currentUser, dto as any, req, res),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(analysisRepository.update).not.toHaveBeenCalled();
      expect(res.writeHead).not.toHaveBeenCalled();
    },
  );
});

describe('AnalysesService#approve', () => {
  const currentUser = {
    id: 'user-1',
    username: null,
    email: 'user@example.com',
  };
  const stageDto = {
    models: { testReviewer: 'gpt-4', architectureReviewer: 'gpt-4' },
  };
  const githubResult = {
    status: 'posted' as const,
    posted: 1,
    skipped: 0,
    reviewId: 99,
    htmlUrl: 'https://example.com/pr/1',
    errorMessage: null,
  };

  it('404s when the analysis belongs to a different user', async () => {
    const { service, analysisRepository } = buildService();
    analysisRepository.findOne.mockResolvedValue(null);
    const { res } = fakeResponse();
    const req = fakeRequest();

    await expect(
      service.approve(
        'analysis-1',
        currentUser,
        { stage: 'publish', decision: 'approve' } as any,
        req,
        res,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(analysisRepository.update).not.toHaveBeenCalled();
    expect((res as any).json).not.toHaveBeenCalled();
  });

  describe('stage: publish', () => {
    it('approve → publishGithubComments called once, status becomes completed, no SSE headers written', async () => {
      const { service, analysisRepository } = buildService();
      const analysis = fakeAnalysis({
        status: 'awaiting_approval',
        approvalStage: 'publish',
        report: { results: [], comments: [] } as any,
      });
      analysisRepository.findOne.mockResolvedValue(analysis);
      const { res } = fakeResponse();
      const req = fakeRequest();
      const publishSpy = jest
        .spyOn(service as any, 'publishGithubComments')
        .mockResolvedValue(githubResult);

      await service.approve(
        analysis.id,
        currentUser,
        { stage: 'publish', decision: 'approve' } as any,
        req,
        res,
      );

      expect(publishSpy).toHaveBeenCalledTimes(1);
      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          analysisId: analysis.id,
          repo: analysis.repo,
          pullNumber: analysis.pullNumber,
          currentUser,
          owner: analysis.owner,
        }),
      );
      expect(analysisRepository.update).toHaveBeenCalledWith(
        analysis.id,
        expect.objectContaining({
          status: 'completed',
          report: expect.objectContaining({ githubComments: githubResult }),
        }),
      );
      expect((res as any).json).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed' }),
      );
      expect(res.writeHead).not.toHaveBeenCalled();
    });

    it('reject → status becomes error, no GitHub call', async () => {
      const { service, analysisRepository } = buildService();
      const analysis = fakeAnalysis({
        status: 'awaiting_approval',
        approvalStage: 'publish',
        report: { results: [], comments: [] } as any,
      });
      analysisRepository.findOne.mockResolvedValue(analysis);
      const { res } = fakeResponse();
      const req = fakeRequest();
      const publishSpy = jest.spyOn(service as any, 'publishGithubComments');

      await service.approve(
        analysis.id,
        currentUser,
        { stage: 'publish', decision: 'reject' } as any,
        req,
        res,
      );

      expect(publishSpy).not.toHaveBeenCalled();
      expect(analysisRepository.update).toHaveBeenCalledWith(
        analysis.id,
        expect.objectContaining({
          status: 'error',
          errorMessage: 'Publicação rejeitada pelo usuário',
        }),
      );
      expect((res as any).json).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'error' }),
      );
      expect(res.writeHead).not.toHaveBeenCalled();
    });
  });

  describe('stage: prd/spec', () => {
    it('prd reject with an excerpt NOT found in current content → BadRequestException, no ai-api call', async () => {
      const { service, analysisRepository, aiApiClient } = buildService();
      const analysis = fakeAnalysis({
        status: 'awaiting_approval',
        approvalStage: 'prd',
        report: {
          results: [],
          comments: [],
          prd: { markdown: 'Current PRD content here.' },
        } as any,
      });
      analysisRepository.findOne.mockResolvedValue(analysis);
      const { res } = fakeResponse();
      const req = fakeRequest();

      await expect(
        service.approve(
          analysis.id,
          currentUser,
          {
            stage: 'prd',
            decision: 'reject',
            annotations: [{ excerpt: 'text nowhere in the prd', note: 'fix' }],
            ...stageDto,
          } as any,
          req,
          res,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(aiApiClient.resumeAgent).not.toHaveBeenCalled();
      expect(analysisRepository.update).not.toHaveBeenCalled();
      expect(res.writeHead).not.toHaveBeenCalled();
    });

    it('prd reject with a valid excerpt → prdIterations gains one entry BEFORE the ai-api call, resumeAgent called with the right decision shape', async () => {
      const { service, analysisRepository, aiApiClient } = buildService();
      const analysis = fakeAnalysis({
        status: 'awaiting_approval',
        approvalStage: 'prd',
        report: {
          results: [],
          comments: [],
          prd: { markdown: 'Current PRD content here.' },
        } as any,
      });
      analysisRepository.findOne.mockResolvedValue(analysis);
      const { res } = fakeResponse();
      const req = fakeRequest();
      const generator = scripted([
        { type: 'prd_generated', payload: { markdown: 'revised' } },
      ]);
      aiApiClient.resumeAgent.mockReturnValue(generator);
      const streamLegSpy = jest
        .spyOn(service as any, 'streamLeg')
        .mockResolvedValue(undefined);
      const annotations = [{ excerpt: 'PRD content', note: 'please clarify' }];

      await service.approve(
        analysis.id,
        currentUser,
        { stage: 'prd', decision: 'reject', annotations, ...stageDto } as any,
        req,
        res,
      );

      expect(analysisRepository.update).toHaveBeenCalledWith(analysis.id, {
        prdIterations: [
          expect.objectContaining({
            content: analysis.report?.prd,
            annotations,
            createdAt: expect.any(String),
          }),
        ],
      });
      expect(aiApiClient.resumeAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          analysisId: analysis.id,
          apiKeys: { openai: 'sk-do-banco' },
          models: stageDto.models,
          policies: { prd: 'manual', spec: 'manual' },
          decision: { stage: 'prd', action: 'reject', annotations },
        }),
        expect.any(AbortSignal),
      );
      expect(
        analysisRepository.update.mock.invocationCallOrder[0],
      ).toBeLessThan(aiApiClient.resumeAgent.mock.invocationCallOrder[0]);
      expect(streamLegSpy).toHaveBeenCalledWith(analysis, generator, res);
      expect(res.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({ 'X-Analysis-Id': analysis.id }),
      );
    });

    it('prd approve → resumeAgent called with action:"approve", no iteration pushed', async () => {
      const { service, analysisRepository, aiApiClient } = buildService();
      const analysis = fakeAnalysis({
        status: 'awaiting_approval',
        approvalStage: 'prd',
        report: {
          results: [],
          comments: [],
          prd: { markdown: 'Current PRD content here.' },
        } as any,
      });
      analysisRepository.findOne.mockResolvedValue(analysis);
      const { res } = fakeResponse();
      const req = fakeRequest();
      const generator = scripted([
        { type: 'spec_generated', payload: { markdown: 'spec' } },
      ]);
      aiApiClient.resumeAgent.mockReturnValue(generator);
      jest.spyOn(service as any, 'streamLeg').mockResolvedValue(undefined);

      await service.approve(
        analysis.id,
        currentUser,
        { stage: 'prd', decision: 'approve', ...stageDto } as any,
        req,
        res,
      );

      expect(analysisRepository.update).not.toHaveBeenCalled();
      expect(aiApiClient.resumeAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: { stage: 'prd', action: 'approve', annotations: null },
        }),
        expect.any(AbortSignal),
      );
    });

    it('spec reject with a valid excerpt → specIterations (not prdIterations) gains one entry', async () => {
      const { service, analysisRepository, aiApiClient } = buildService();
      const analysis = fakeAnalysis({
        status: 'awaiting_approval',
        approvalStage: 'spec',
        report: {
          results: [],
          comments: [],
          spec: { markdown: 'Current SPEC content here.' },
        } as any,
      });
      analysisRepository.findOne.mockResolvedValue(analysis);
      const { res } = fakeResponse();
      const req = fakeRequest();
      aiApiClient.resumeAgent.mockReturnValue(scripted([]));
      jest.spyOn(service as any, 'streamLeg').mockResolvedValue(undefined);
      const annotations = [{ excerpt: 'SPEC content', note: 'needs detail' }];

      await service.approve(
        analysis.id,
        currentUser,
        { stage: 'spec', decision: 'reject', annotations, ...stageDto } as any,
        req,
        res,
      );

      expect(analysisRepository.update).toHaveBeenCalledWith(analysis.id, {
        specIterations: [
          expect.objectContaining({
            content: analysis.report?.spec,
            annotations,
          }),
        ],
      });
      expect(aiApiClient.resumeAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          decision: { stage: 'spec', action: 'reject', annotations },
        }),
        expect.any(AbortSignal),
      );
    });
  });
});
