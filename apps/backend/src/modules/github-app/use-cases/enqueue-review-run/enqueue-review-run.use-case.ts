import { randomUUID } from 'node:crypto';
import type { Queue } from 'bullmq';
import { AppLogger } from 'src/shared/logger/logger.service';
import { In, Not } from 'typeorm';
import type { GithubAppRepository } from '../../entities/github-app-repository.entity';
import type { GithubInstallation } from '../../entities/github-installation.entity';
import type {
  GithubReviewRunTrigger,
  GithubReviewSkipReason,
} from '../../domain/github-app.types';
import {
  buildReviewJobId,
  type GithubReviewJobData,
} from '../../infrastructure/queue/github-review-queue.constants';
import {
  budgetMonthFor,
  hashRepositoryConfig,
} from '../../domain/config-hash';
import type { GithubReviewRunRepository } from '../../infrastructure/persistence/github-review-run.repository';

const OPEN_STATUS = ['queued', 'running'];

export interface EnqueueReviewRunInput {
  installation: GithubInstallation;
  repository: GithubAppRepository;
  facts: {
    pullNumber: number;
    headSha: string;
    baseRef: string;
    owner: string;
    repo: string;
  };
  trigger: GithubReviewRunTrigger;
  eventAction: string | null;
  deliveryId: string | null;
}

export type EnqueueOutcome =
  | { status: 'queued'; reviewRunId: string }
  | { status: 'duplicate'; reviewRunId: string | null };

export class EnqueueReviewRunUseCase {
  constructor(
    private readonly reviewRunRepository: GithubReviewRunRepository,
    private readonly reviewQueue: Queue<GithubReviewJobData>,
    private readonly logger: AppLogger,
  ) {}

  async execute(input: EnqueueReviewRunInput): Promise<EnqueueOutcome> {
    const { installation, repository, facts } = input;
    const configHash = hashRepositoryConfig(repository.config);

    const duplicate = await this.reviewRunRepository.findOne({
      where: {
        repositoryId: repository.id,
        pullNumber: facts.pullNumber,
        headSha: facts.headSha,
        configHash,
      },
    });
    if (duplicate) {
      this.logger.log(
        'Execução lógica já existe para o mesmo SHA e configuração',
        {
          reviewRunId: duplicate.id,
          pullNumber: facts.pullNumber,
          headSha: facts.headSha,
        },
      );
      return { status: 'duplicate', reviewRunId: duplicate.id };
    }

    await this.supersedeOpenRuns(
      installation.installationId,
      facts.pullNumber,
      facts.headSha,
      'superseded',
      repository.id,
    );

    const run = await this.reviewRunRepository.save(
      this.reviewRunRepository.create({
        id: randomUUID(),
        installationId: installation.id,
        repositoryId: repository.id,
        githubInstallationId: installation.installationId,
        owner: repository.owner,
        repo: repository.repo,
        pullNumber: facts.pullNumber,
        headSha: facts.headSha,
        baseRef: facts.baseRef,
        configHash,
        deliveryId: input.deliveryId,
        trigger: input.trigger,
        eventAction: input.eventAction,
        status: 'queued',
        skipReason: null,
        errorMessage: null,
        analysisId: null,
        checkRun: null,
        budgetMonth: budgetMonthFor(),
        reservedUsd: 0,
        consumedUsd: null,
        attempts: 0,
        queuedAt: new Date(),
        startedAt: null,
        finishedAt: null,
      }),
    );

    await this.reviewQueue.add(
      'review',
      { reviewRunId: run.id },
      {
        jobId: buildReviewJobId(run.id),
        attempts: 3,
        backoff: { type: 'exponential', delay: 10_000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    );

    this.logger.log('Execução de revisão enfileirada', {
      reviewRunId: run.id,
      repository: repository.fullName,
      pullNumber: facts.pullNumber,
      headSha: facts.headSha,
      trigger: input.trigger,
    });

    return { status: 'queued', reviewRunId: run.id };
  }

  async supersedeOpenRuns(
    githubInstallationId: string,
    pullNumber: number,
    newHeadSha: string | null,
    reason: GithubReviewSkipReason,
    repositoryId?: string,
  ): Promise<void> {
    const open = await this.reviewRunRepository.find({
      where: {
        githubInstallationId,
        pullNumber,
        status: In(OPEN_STATUS),
        ...(repositoryId ? { repositoryId } : {}),
        ...(newHeadSha ? { headSha: Not(newHeadSha) } : {}),
      },
    });

    for (const run of open) {
      await this.reviewRunRepository.update(run.id, {
        status: 'superseded',
        skipReason: reason,
        finishedAt: new Date(),
      });

      const job = await this.reviewQueue.getJob(buildReviewJobId(run.id));
      if (job) {
        const state = await job.getState();
        if (state === 'waiting' || state === 'delayed') {
          await job.remove();
        }
      }

      this.logger.log('Execução anterior marcada como superseded', {
        reviewRunId: run.id,
        pullNumber,
        newHeadSha,
      });
    }
  }
}
