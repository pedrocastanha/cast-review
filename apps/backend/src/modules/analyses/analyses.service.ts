import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AiApiClient } from 'src/shared/clients/ai/ai-api.client';
import { AppLogger } from 'src/shared/logger/logger.service';
import { BaseService } from 'src/shared/services/base.service';
import type {
  AgentEvent,
  AgentResumeRequest,
  FrozenImpactScope,
} from 'src/shared/types';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { FindingCaseRepository } from '../finding-cases/finding-case.repository';
import { FindingCaseEventRepository } from '../finding-cases/finding-case-event.repository';
import { FindingOccurrenceRepository } from '../finding-cases/finding-occurrence.repository';
import { FindingLifecycleUseCase } from '../finding-cases/use-cases/finding-lifecycle/finding-lifecycle.use-case';
import { ProjectsService } from '../projects/projects.service';
import { RepositoriesService } from '../repositories/repositories.service';
import type { UserService } from '../users/user.service';
import type {
  AnalysisContextSnapshot,
  AnalysisRecord,
  AnalysisReview,
  FindingLifecycleSummary,
  GithubCommentsResult,
  Iteration,
  PublishPolicy,
} from './analyses.types';
import { Analysis } from './analysis.entity';
import { AnalysisRepository } from './analysis.repository';
import { AnalysisContextSnapshotRepository } from './analysis-context-snapshot.repository';
import type { ApproveAnalysisDto } from './dtos/approve-analysis.dto';
import type { ResumeAnalysisDto } from './dtos/resume-analysis.dto';
import {
  applyReviewEvent,
  emptyReview,
  hydrateReview,
} from './helpers/apply-review-event';
import { buildAgentRunRequest } from './helpers/context-builder.helper';
import {
  buildReviewBody,
  collectActionable,
  collectPublishable,
  emptyGithubComments,
  isCastReviewComment,
  planInlineComments,
} from './helpers/github-review.helper';
import {
  parseOptionalPullNumber,
  parsePullNumber,
  parseRunAnalysisBody,
} from './helpers/parse-run-input';

type RunInput = {
  repo: string;
  pullNumber: string;
  currentUser: CurrentUserData;
  body: unknown;
  owner?: string;
  req: Request;
  res: Response;
};

@Injectable()
export class AnalysesService extends BaseService {
  private readonly findingLifecycleUseCase: FindingLifecycleUseCase;

  constructor(
    private readonly repositoriesService: RepositoriesService,
    private readonly aiApiClient: AiApiClient,
    private readonly analysisRepository: AnalysisRepository,
    private readonly contextSnapshotRepository: AnalysisContextSnapshotRepository,
    findingCaseRepository: FindingCaseRepository,
    findingOccurrenceRepository: FindingOccurrenceRepository,
    findingCaseEventRepository: FindingCaseEventRepository,
    private readonly projectsService: ProjectsService,
    @Inject('USER_SERVICE')
    private readonly userService: UserService,
    logger: AppLogger,
  ) {
    super(logger);
    this.findingLifecycleUseCase = new FindingLifecycleUseCase(
      findingCaseRepository,
      findingOccurrenceRepository,
      findingCaseEventRepository,
      analysisRepository,
    );
  }

  listFindingLifecycle(
    analysisId: string,
    currentUser: CurrentUserData,
    query: { view?: string; limit?: string; cursor?: string },
  ) {
    return this.findingLifecycleUseCase.listForAnalysis(
      analysisId,
      currentUser.id,
      query,
    );
  }

  async run({
    repo,
    pullNumber: pullNumberRaw,
    currentUser,
    body,
    owner,
    req,
    res,
  }: RunInput) {
    if (!repo?.trim()) {
      throw new BadRequestException('repo é obrigatório');
    }

    const pullNumber = parsePullNumber(pullNumberRaw);
    const parsed = parseRunAnalysisBody(body);
    const dto = {
      ...parsed,
      apiKeys: { openai: await this.userService.getOpenaiKey(currentUser.id) },
    };
    const requestedOwner = owner?.trim() || '';
    const sourceOwner =
      dto.impactScope.mode === 'project'
        ? requestedOwner ||
          (await this.repositoriesService.loginFor(currentUser))
        : requestedOwner;
    const sourceRepoId = sourceOwner ? `${sourceOwner}/${repo}` : '';
    const impactScope: FrozenImpactScope =
      dto.impactScope.mode === 'project'
        ? await this.projectsService.resolveAnalysisScope(
            dto.impactScope.projectId,
            sourceRepoId,
            currentUser,
          )
        : {
            requestedMode: 'repository',
            effectiveMode: 'repository',
            status: 'exact',
            projectId: null,
            projectName: null,
            fallbackReason: null,
            repositories: [],
          };
    const publishPolicy: PublishPolicy = {
      prd: dto.policies?.prd ?? 'manual',
      spec: dto.policies?.spec ?? 'manual',
      publish: dto.policies?.publish ?? 'manual',
    };

    const analysis = await this.analysisRepository.save(
      this.analysisRepository.create({
        id: randomUUID(),
        requestedBy: currentUser.id,
        owner: owner?.trim() || '',
        repo,
        pullNumber,
        status: 'running',
        report: emptyReview(),
        thoughts: {},
        errorMessage: null,
        models: dto.models,
        impactScope: {
          requestedMode: impactScope.requestedMode,
          effectiveMode: impactScope.effectiveMode,
          status: impactScope.status,
          projectId: impactScope.projectId,
          projectName: impactScope.projectName,
          fallbackReason: impactScope.fallbackReason,
        },
        finishedAt: null,
        publishPolicy,
      }),
    );

    this.logger.log('Análise iniciada', {
      analysisId: analysis.id,
      repo,
      pullNumber,
    });

    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Analysis-Id': analysis.id,
    });
    res.flushHeaders();

    try {
      const payload = await buildAgentRunRequest(
        this.repositoriesService,
        repo,
        pullNumber,
        currentUser,
        dto,
        analysis.id,
        sourceOwner || undefined,
        impactScope,
      );

      await this.streamLeg(
        analysis,
        this.aiApiClient.runAgent(payload, abortController.signal),
        res,
      );
    } catch (err) {
      await this.analysisRepository.update(analysis.id, {
        status: 'error',
        errorMessage:
          err instanceof Error ? err.message : 'Falha inesperada na análise',
        finishedAt: new Date(),
      });
      this.logger.error('Falha ao rodar análise', {
        exception: err,
        analysisId: analysis.id,
      });
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          payload: { message: 'Falha ao rodar a análise' },
        })}\n\n`,
      );
      res.end();
    }
  }

  async resume(
    analysisId: string,
    currentUser: CurrentUserData,
    dto: ResumeAnalysisDto,
    req: Request,
    res: Response,
  ): Promise<void> {
    const analysis = await this.analysisRepository.findOne({
      where: { id: analysisId, requestedBy: currentUser.id },
    });

    if (!analysis) {
      throw new NotFoundException('Análise não encontrada');
    }

    if (analysis.status !== 'running' && analysis.status !== 'error') {
      throw new ConflictException('Análise não pode ser retomada neste status');
    }

    await this.analysisRepository.update(analysisId, {
      resumedCount: analysis.resumedCount + 1,
    });

    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Analysis-Id': analysis.id,
    });
    res.flushHeaders();

    const payload: AgentResumeRequest = {
      analysisId: analysis.id,
      models: dto.models,
      apiKeys: { openai: await this.userService.getOpenaiKey(currentUser.id) },
      policies: analysis.publishPolicy
        ? { prd: analysis.publishPolicy.prd, spec: analysis.publishPolicy.spec }
        : { prd: 'manual', spec: 'manual' },
      decision: null,
    };

    await this.streamLeg(
      analysis,
      this.aiApiClient.resumeAgent(payload, abortController.signal),
      res,
    );
  }

  async approve(
    analysisId: string,
    currentUser: CurrentUserData,
    dto: ApproveAnalysisDto,
    req: Request,
    res: Response,
  ): Promise<void> {
    const analysis = await this.analysisRepository.findOne({
      where: { id: analysisId, requestedBy: currentUser.id },
    });

    if (!analysis) {
      throw new NotFoundException('Análise não encontrada');
    }

    if (dto.stage === 'publish') {
      await this.approvePublish(analysis, dto, currentUser, res);
      return;
    }

    await this.approveStage(analysis, dto, req, res);
  }

  private async approvePublish(
    analysis: Analysis,
    dto: ApproveAnalysisDto,
    currentUser: CurrentUserData,
    res: Response,
  ): Promise<void> {
    const review = hydrateReview(analysis.report) ?? emptyReview();
    const finishedAt = new Date();

    if (dto.decision === 'reject') {
      const errorMessage = 'Publicação rejeitada pelo usuário';
      await this.analysisRepository.update(analysis.id, {
        status: 'error',
        errorMessage,
        finishedAt,
      });
      analysis.status = 'error';
      analysis.errorMessage = errorMessage;
      analysis.finishedAt = finishedAt;
      res.json(this.toRecord(analysis));
      return;
    }

    const github = await this.publishGithubComments({
      analysisId: analysis.id,
      review,
      repo: analysis.repo,
      pullNumber: analysis.pullNumber,
      currentUser,
      owner: analysis.owner,
    });
    const updatedReview = applyReviewEvent(review, 'github_comments_done', {
      ...github,
    });

    await this.analysisRepository.update(analysis.id, {
      status: 'completed',
      report: updatedReview,
      finishedAt,
    });

    analysis.status = 'completed';
    analysis.report = updatedReview;
    analysis.finishedAt = finishedAt;
    res.json(this.toRecord(analysis));
  }

  private async approveStage(
    analysis: Analysis,
    dto: ApproveAnalysisDto,
    req: Request,
    res: Response,
  ): Promise<void> {
    const stage = dto.stage as 'prd' | 'spec';
    const iterationsField =
      stage === 'prd' ? 'prdIterations' : 'specIterations';

    if (dto.decision === 'reject') {
      const currentContent =
        stage === 'prd' ? analysis.report?.prd : analysis.report?.spec;
      const currentMarkdown =
        currentContent && typeof currentContent.markdown === 'string'
          ? currentContent.markdown
          : '';

      for (const annotation of dto.annotations ?? []) {
        if (!currentMarkdown.includes(annotation.excerpt)) {
          throw new BadRequestException(
            `Trecho não encontrado no conteúdo atual de ${stage}: "${annotation.excerpt}"`,
          );
        }
      }

      const iteration: Iteration = {
        content: currentContent ?? {},
        annotations: dto.annotations ?? null,
        createdAt: new Date().toISOString(),
      };
      const iterations = [...(analysis[iterationsField] ?? []), iteration];

      await this.analysisRepository.update(analysis.id, {
        [iterationsField]: iterations,
      });
      analysis[iterationsField] = iterations;
    }

    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Analysis-Id': analysis.id,
    });
    res.flushHeaders();

    try {
      const payload: AgentResumeRequest = {
        analysisId: analysis.id,
        apiKeys: {
          openai: await this.userService.getOpenaiKey(analysis.requestedBy),
        },
        models: dto.models!,
        policies: analysis.publishPolicy
          ? {
              prd: analysis.publishPolicy.prd,
              spec: analysis.publishPolicy.spec,
            }
          : { prd: 'manual', spec: 'manual' },
        decision: {
          stage,
          action: dto.decision,
          annotations: dto.annotations ?? null,
        },
      };

      await this.streamLeg(
        analysis,
        this.aiApiClient.resumeAgent(payload, abortController.signal),
        res,
      );
    } catch (err) {
      await this.analysisRepository.update(analysis.id, {
        status: 'error',
        errorMessage:
          err instanceof Error ? err.message : 'Falha inesperada na análise',
        finishedAt: new Date(),
      });
      this.logger.error('Falha ao rodar análise', {
        exception: err,
        analysisId: analysis.id,
      });
      res.write(
        `data: ${JSON.stringify({
          type: 'error',
          payload: { message: 'Falha ao rodar a análise' },
        })}\n\n`,
      );
      res.end();
    }
  }

  private async streamLeg(
    analysis: Analysis,
    events: AsyncGenerator<AgentEvent>,
    res: Response,
  ): Promise<void> {
    const thoughts: Record<string, string> = { ...(analysis.thoughts ?? {}) };
    let review: AnalysisReview =
      hydrateReview(analysis.report) ?? emptyReview();
    let lastThoughtPersist = 0;

    const writeEvent = (event: {
      type: string;
      payload: Record<string, unknown>;
    }) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const persistThoughts = async (force = false) => {
      const now = Date.now();
      if (!force && now - lastThoughtPersist < 1500) return;
      lastThoughtPersist = now;
      await this.analysisRepository.update(analysis.id, {
        thoughts,
        report: review,
      });
    };

    const persistReview = async (
      extra: Partial<
        Pick<
          Analysis,
          'status' | 'errorMessage' | 'finishedAt' | 'approvalStage'
        >
      > = {},
    ) => {
      await this.analysisRepository.update(analysis.id, {
        report: review,
        thoughts,
        ...extra,
      });
    };

    const publishingUser: CurrentUserData = {
      id: analysis.requestedBy,
      username: null,
      email: '',
    };

    try {
      for await (const event of events) {
        if (event.type === 'thought') {
          const step = String(event.payload.step ?? '');
          const delta = String(event.payload.delta ?? '');
          if (step && delta) {
            thoughts[step] = `${thoughts[step] ?? ''}${delta}`;
            await persistThoughts();
          }
        } else if (event.type === 'error') {
          await persistReview({
            status: 'error',
            errorMessage: String(
              event.payload.message ?? 'Falha no pipeline de agentes',
            ),
            finishedAt: new Date(),
          });
        } else if (event.type === 'awaiting_approval') {
          const rawStage = event.payload.stage;
          const stage =
            rawStage === 'prd' || rawStage === 'spec' ? rawStage : null;
          await persistReview({
            status: 'awaiting_approval',
            approvalStage: stage,
          });
          writeEvent(event);
          return;
        } else {
          if (event.type === 'change_analysis_done') {
            await this.persistContextSnapshot(analysis.id, event.payload);
          }
          review = applyReviewEvent(review, event.type, event.payload);
          if (event.type === 'report_ready') {
            const lifecycleSummary = await this.reconcileFindingLifecycle(
              analysis,
              review,
              publishingUser,
            );
            review = lifecycleSummary.review;
            if (analysis.publishPolicy?.publish === 'auto') {
              await persistReview({
                status: 'completed',
                finishedAt: new Date(),
              });
              writeEvent(event);
              writeEvent({
                type: 'finding_lifecycle_done',
                payload: { ...lifecycleSummary.summary },
              });

              const github = await this.publishGithubComments({
                analysisId: analysis.id,
                review,
                repo: analysis.repo,
                pullNumber: analysis.pullNumber,
                currentUser: publishingUser,
                owner: analysis.owner,
              });
              const githubPayload = { ...github } as Record<string, unknown>;
              review = applyReviewEvent(
                review,
                'github_comments_done',
                githubPayload,
              );
              await persistReview();
              writeEvent({
                type: 'github_comments_done',
                payload: githubPayload,
              });
              continue;
            }

            await persistReview({
              status: 'awaiting_approval',
              approvalStage: 'publish',
              finishedAt: new Date(),
            });
            writeEvent(event);
            writeEvent({
              type: 'finding_lifecycle_done',
              payload: { ...lifecycleSummary.summary },
            });
            writeEvent({
              type: 'awaiting_approval',
              payload: { stage: 'publish' },
            });
            return;
          }
          await persistReview();
        }

        writeEvent(event);
      }

      await persistThoughts(true);
      this.logger.log('Stream de análise finalizado', {
        analysisId: analysis.id,
        verdict: review.verdict ?? 'unknown',
      });
    } catch (err) {
      await this.analysisRepository.update(analysis.id, {
        status: 'error',
        report: review,
        thoughts,
        errorMessage:
          err instanceof Error ? err.message : 'Falha inesperada na análise',
        finishedAt: new Date(),
      });
      this.logger.error('Falha ao rodar análise', {
        exception: err,
        analysisId: analysis.id,
      });
      writeEvent({
        type: 'error',
        payload: { message: 'Falha ao rodar a análise' },
      });
    } finally {
      res.end();
    }
  }

  async listForUser(currentUser: CurrentUserData): Promise<AnalysisRecord[]> {
    const rows = await this.analysisRepository.find({
      where: { requestedBy: currentUser.id },
      order: { createdAt: 'DESC' },
    });
    return rows.map((row) => this.toRecord(row));
  }

  async listForRepository(input: {
    repo: string;
    owner?: string;
    pullNumber?: string;
    currentUser: CurrentUserData;
  }): Promise<AnalysisRecord[]> {
    if (!input.repo?.trim()) {
      throw new BadRequestException('repo é obrigatório');
    }

    const pullNumber = parseOptionalPullNumber(input.pullNumber);
    const owner = input.owner?.trim();

    const query = this.analysisRepository
      .createQueryBuilder('analysis')
      .where('analysis.requestedBy = :userId', { userId: input.currentUser.id })
      .andWhere('LOWER(analysis.repo) = LOWER(:repo)', {
        repo: input.repo.trim(),
      })
      .orderBy('analysis.createdAt', 'DESC');

    if (owner) {
      query.andWhere(
        '(LOWER(analysis.owner) = LOWER(:owner) OR analysis.owner = :emptyOwner)',
        { owner, emptyOwner: '' },
      );
    }

    if (pullNumber !== undefined) {
      query.andWhere('analysis.pullNumber = :pullNumber', { pullNumber });
    }

    const rows = await query.getMany();
    return rows.map((row) => this.toRecord(row));
  }

  async getByIdForUser(
    id: string,
    currentUser: CurrentUserData,
  ): Promise<AnalysisRecord> {
    const row = await this.analysisRepository.findOne({
      where: { id, requestedBy: currentUser.id },
    });

    if (!row) {
      throw new NotFoundException('Análise não encontrada');
    }

    return this.toRecord(row);
  }

  async getContextSnapshotForUser(
    id: string,
    currentUser: CurrentUserData,
  ): Promise<AnalysisContextSnapshot> {
    const analysis = await this.analysisRepository.findOne({
      where: { id, requestedBy: currentUser.id },
    });
    if (!analysis) {
      throw new NotFoundException('Análise não encontrada');
    }

    const row = await this.contextSnapshotRepository.findOne({
      where: { analysisId: id },
    });
    if (!row) {
      throw new NotFoundException('Contexto histórico indisponível');
    }
    return row.graphSnapshot;
  }

  private async persistContextSnapshot(
    analysisId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const snapshot = payload.graphSnapshot;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      return;
    }
    const value = snapshot as Partial<AnalysisContextSnapshot>;
    if (!value.snapshotHash || !value.schemaVersion) {
      return;
    }

    try {
      await this.contextSnapshotRepository.save(
        this.contextSnapshotRepository.create({
          id: randomUUID(),
          analysisId,
          schemaVersion: value.schemaVersion,
          snapshotHash: value.snapshotHash,
          graphSnapshot: snapshot as AnalysisContextSnapshot,
        }),
      );
      const scope = (snapshot as { scope?: unknown }).scope;
      if (scope && typeof scope === 'object' && !Array.isArray(scope)) {
        const value = scope as Record<string, unknown>;
        if (
          (value.requestedMode === 'repository' ||
            value.requestedMode === 'project') &&
          (value.effectiveMode === 'repository' ||
            value.effectiveMode === 'project') &&
          (value.status === 'exact' ||
            value.status === 'degraded' ||
            value.status === 'fallback')
        ) {
          await this.analysisRepository.update(analysisId, {
            impactScope: {
              requestedMode: value.requestedMode,
              effectiveMode: value.effectiveMode,
              status: value.status,
              projectId:
                typeof value.projectId === 'string' ? value.projectId : null,
              projectName:
                typeof value.projectName === 'string'
                  ? value.projectName
                  : null,
              fallbackReason:
                typeof value.fallbackReason === 'string'
                  ? value.fallbackReason
                  : null,
            },
          });
        }
      }
    } catch (err) {
      this.logger.error('Falha ao persistir snapshot de contexto', {
        exception: err,
        analysisId,
      });
    }
  }

  private async publishGithubComments(input: {
    analysisId: string;
    review: AnalysisReview;
    repo: string;
    pullNumber: number;
    currentUser: CurrentUserData;
    owner?: string;
  }): Promise<GithubCommentsResult> {
    try {
      const actionable = collectActionable(input.review);
      if (actionable.length === 0) {
        return emptyGithubComments();
      }

      let currentDispositions = new Map();
      try {
        currentDispositions =
          await this.findingLifecycleUseCase.currentDispositions(
            actionable.flatMap((item) =>
              item.lifecycle?.caseId ? [item.lifecycle.caseId] : [],
            ),
            input.currentUser.id,
          );
      } catch (err) {
        this.logger.warn('Falha ao carregar disposições atuais dos findings', {
          exception: err,
          analysisId: input.analysisId,
        });
      }
      const publishable = collectPublishable(input.review, currentDispositions);
      if (publishable.length === 0) return emptyGithubComments();
      const suppressed = actionable.length - publishable.length;
      const publishableReview = { ...input.review, comments: publishable };

      const [files, headSha, login] = await Promise.all([
        this.repositoriesService.listPullFiles(
          input.repo,
          input.pullNumber,
          input.currentUser,
          input.owner,
        ),
        this.repositoriesService.getPullHeadSha(
          input.repo,
          input.pullNumber,
          input.currentUser,
          input.owner,
        ),
        this.repositoriesService.loginFor(input.currentUser),
      ]);

      const { comments, skipped } = planInlineComments(
        input.analysisId,
        publishableReview,
        files,
      );

      const existing = await this.repositoriesService.listPullReviewComments(
        input.repo,
        input.pullNumber,
        input.currentUser,
        input.owner,
      );
      for (const comment of existing) {
        if (comment.user === login && isCastReviewComment(comment.body)) {
          await this.repositoriesService.deletePullReviewComment(
            input.repo,
            comment.id,
            input.currentUser,
            input.owner,
          );
        }
      }

      const created = await this.repositoriesService.createPullReview(
        input.repo,
        input.pullNumber,
        {
          commitId: headSha,
          body: buildReviewBody(
            input.analysisId,
            publishableReview,
            comments.length,
            suppressed,
          ),
          comments: comments.map((comment) => ({
            path: comment.path,
            line: comment.line,
            startLine: comment.startLine,
            body: comment.body,
          })),
        },
        input.currentUser,
        input.owner,
      );

      this.logger.log('Comentários publicados na PR', {
        analysisId: input.analysisId,
        posted: comments.length,
        skipped,
      });

      return {
        status: 'posted',
        posted: comments.length,
        skipped,
        reviewId: created.id,
        htmlUrl: created.htmlUrl,
        errorMessage: null,
      };
    } catch (err) {
      this.logger.error('Falha ao comentar na PR', {
        exception: err,
        analysisId: input.analysisId,
      });
      return {
        status: 'error',
        posted: 0,
        skipped: 0,
        reviewId: null,
        htmlUrl: null,
        errorMessage:
          err instanceof Error ? err.message : 'Falha ao comentar na PR',
      };
    }
  }

  private async reconcileFindingLifecycle(
    analysis: Analysis,
    review: AnalysisReview,
    currentUser: CurrentUserData,
  ): Promise<{ review: AnalysisReview; summary: FindingLifecycleSummary }> {
    try {
      const owner =
        analysis.owner.trim() ||
        (await this.repositoriesService.loginFor(currentUser));
      const result = await this.findingLifecycleUseCase.reconcile({
        analysis,
        review,
        owner,
      });
      const comments = review.comments.map((comment, index) => {
        const lifecycle = result.metadataByCommentIndex.get(index);
        return lifecycle ? { ...comment, lifecycle } : comment;
      });
      const decorated = applyReviewEvent(
        { ...review, comments },
        'finding_lifecycle_done',
        { ...result.summary },
      );
      return { review: decorated, summary: result.summary };
    } catch (err) {
      const summary: FindingLifecycleSummary = {
        status: 'unavailable',
        baselineAnalysisId: null,
        modelChanged: false,
        newCount: 0,
        recurringCount: 0,
        reopenedCount: 0,
        notObservedCount: 0,
        acknowledgedCount: 0,
        suppressedFromGithubCount: 0,
        errorCode: 'reconciliation_failed',
      };
      this.logger.error('Falha ao reconciliar lifecycle de findings', {
        exception: err,
        analysisId: analysis.id,
      });
      return {
        review: applyReviewEvent(review, 'finding_lifecycle_done', {
          ...summary,
        }),
        summary,
      };
    }
  }

  private toRecord(row: Analysis): AnalysisRecord {
    return {
      id: row.id,
      requestedBy: row.requestedBy,
      owner: row.owner,
      repo: row.repo,
      pullNumber: row.pullNumber,
      status: row.status,
      report: hydrateReview(row.report),
      thoughts: row.thoughts,
      errorMessage: row.errorMessage,
      models: row.models,
      impactScope: row.impactScope,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
      approvalStage: row.approvalStage,
      publishPolicy: row.publishPolicy,
      prdIterations: row.prdIterations,
      specIterations: row.specIterations,
      resumedCount: row.resumedCount,
    };
  }
}
