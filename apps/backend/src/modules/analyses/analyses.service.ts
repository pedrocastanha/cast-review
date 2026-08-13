import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AiApiClient } from 'src/shared/clients/ai/ai-api.client';
import { AppLogger } from 'src/shared/logger/logger.service';
import { BaseService } from 'src/shared/services/base.service';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { RepositoriesService } from '../repositories/repositories.service';
import type {
  AnalysisRecord,
  AnalysisReview,
  GithubCommentsResult,
} from './analyses.types';
import { Analysis } from './analysis.entity';
import { AnalysisRepository } from './analysis.repository';
import {
  applyReviewEvent,
  emptyReview,
  hydrateReview,
} from './helpers/apply-review-event';
import { buildAgentRunRequest } from './helpers/context-builder.helper';
import {
  buildReviewBody,
  collectActionable,
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
  constructor(
    private readonly repositoriesService: RepositoriesService,
    private readonly aiApiClient: AiApiClient,
    private readonly analysisRepository: AnalysisRepository,
    logger: AppLogger,
  ) {
    super(logger);
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
    const dto = parseRunAnalysisBody(body);

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
        finishedAt: null,
      }),
    );

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

    const thoughts: Record<string, string> = {};
    let review: AnalysisReview = emptyReview();
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
        Pick<Analysis, 'status' | 'errorMessage' | 'finishedAt'>
      > = {},
    ) => {
      await this.analysisRepository.update(analysis.id, {
        report: review,
        thoughts,
        ...extra,
      });
    };

    try {
      const payload = await buildAgentRunRequest(
        this.repositoriesService,
        repo,
        pullNumber,
        currentUser,
        dto,
        owner,
      );

      for await (const event of this.aiApiClient.runAgent(
        payload,
        abortController.signal,
      )) {
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
        } else {
          review = applyReviewEvent(review, event.type, event.payload);
          if (event.type === 'report_ready') {
            await persistReview({
              status: 'completed',
              finishedAt: new Date(),
            });
            writeEvent(event);

            const github = await this.publishGithubComments({
              analysisId: analysis.id,
              review,
              repo,
              pullNumber,
              currentUser,
              owner,
            });
            review = applyReviewEvent(review, 'github_comments_done', github);
            await persistReview();
            writeEvent({ type: 'github_comments_done', payload: github });
            continue;
          }
          await persistReview();
        }

        writeEvent(event);
      }

      await persistThoughts(true);
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

  private async publishGithubComments(input: {
    analysisId: string;
    review: AnalysisReview;
    repo: string;
    pullNumber: number;
    currentUser: CurrentUserData;
    owner?: string;
  }): Promise<GithubCommentsResult> {
    try {
      if (collectActionable(input.review).length === 0) {
        return emptyGithubComments();
      }

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
        input.review,
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
            input.review,
            comments.length,
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
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    };
  }
}
