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
  const repositoriesService = {};
  const aiApiClient = { resumeAgent: jest.fn() };
  const logger = { error: jest.fn(), log: jest.fn(), warn: jest.fn() };

  const service = new AnalysesService(
    repositoriesService as any,
    aiApiClient as any,
    analysisRepository as any,
    logger as any,
  );

  return { service, analysisRepository, aiApiClient, logger };
}

function publishPolicy(publish: PublishPolicy['publish']): PublishPolicy {
  return { prd: 'manual', spec: 'manual', publish };
}

describe('AnalysesService#streamLeg', () => {
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
    expect(emitted[1]).toEqual({
      type: 'awaiting_approval',
      payload: { stage: 'publish' },
    });
    expect(emitted).toHaveLength(2);
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
    expect(emitted[1]).toEqual({
      type: 'github_comments_done',
      payload: githubResult,
    });
    expect(emitted).toHaveLength(2);
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

describe('AnalysesService#resume', () => {
  const currentUser = { id: 'user-1', username: null, email: 'user@example.com' };
  const dto = {
    models: { testReviewer: 'gpt-4', architectureReviewer: 'gpt-4' },
    apiKeys: { openai: 'sk-test' },
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
        apiKeys: dto.apiKeys,
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
  const currentUser = { id: 'user-1', username: null, email: 'user@example.com' };
  const stageDto = {
    apiKeys: { openai: 'sk-test' },
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
            content: analysis.report!.prd,
            annotations,
            createdAt: expect.any(String),
          }),
        ],
      });
      expect(aiApiClient.resumeAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          analysisId: analysis.id,
          apiKeys: stageDto.apiKeys,
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
            content: analysis.report!.spec,
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
