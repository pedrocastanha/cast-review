import { AppLogger } from 'src/shared/logger/logger.service';
import { In, Not } from 'typeorm';
import type { GithubAppRepository } from '../../entities/github-app-repository.entity';
import { GithubReviewRun } from '../../entities/github-review-run.entity';
import type { BudgetUsage } from '../../domain/github-app.types';
import { budgetMonthFor } from '../../domain/config-hash';
import type { GithubReviewRunRepository } from '../../infrastructure/persistence/github-review-run.repository';

export const DEFAULT_RUN_RESERVATION_USD = 0.5;

const CONSUMING_STATUS = ['queued', 'running', 'completed'];

export class ReserveBudgetUseCase {
  constructor(
    private readonly reviewRunRepository: GithubReviewRunRepository,
    private readonly logger: AppLogger,
  ) {}

  reservationFor(repository: GithubAppRepository): number {
    return repository.config.budgetPerRunUsd ?? DEFAULT_RUN_RESERVATION_USD;
  }

  async usage(
    repository: GithubAppRepository,
    month = budgetMonthFor(),
  ): Promise<BudgetUsage> {
    const runs = await this.reviewRunRepository.find({
      where: {
        repositoryId: repository.id,
        budgetMonth: month,
        status: In(CONSUMING_STATUS),
      },
    });

    const consumedUsd = runs.reduce(
      (total, run) => total + (run.consumedUsd ?? 0),
      0,
    );
    const reservedUsd = runs.reduce(
      (total, run) => total + (run.consumedUsd === null ? run.reservedUsd : 0),
      0,
    );
    const limitUsd = repository.config.budgetMonthlyUsd;

    return {
      month,
      consumedUsd,
      reservedUsd,
      limitUsd,
      remainingUsd:
        limitUsd === null
          ? null
          : Math.max(0, limitUsd - consumedUsd - reservedUsd),
    };
  }

  async execute(
    repository: GithubAppRepository,
    reviewRunId: string,
    amountUsd: number,
    month = budgetMonthFor(),
  ): Promise<boolean> {
    const limitUsd = repository.config.budgetMonthlyUsd;

    if (limitUsd === null) {
      await this.reviewRunRepository.update(reviewRunId, {
        reservedUsd: amountUsd,
      });
      return true;
    }

    return this.reviewRunRepository.datasource.transaction(
      'SERIALIZABLE',
      async (manager) => {
        const runs = await manager.find(GithubReviewRun, {
          where: {
            repositoryId: repository.id,
            budgetMonth: month,
            status: In(CONSUMING_STATUS),
            id: Not(reviewRunId),
          },
        });
        const committed = runs.reduce(
          (total, run) => total + (run.consumedUsd ?? run.reservedUsd),
          0,
        );

        if (committed + amountUsd > limitUsd) {
          this.logger.warn('Reserva de orçamento recusada', {
            repositoryId: repository.id,
            month,
            committed,
            amountUsd,
            limitUsd,
          });
          return false;
        }

        await manager.update(GithubReviewRun, reviewRunId, {
          reservedUsd: amountUsd,
        });
        return true;
      },
    );
  }

  async settle(reviewRunId: string, consumedUsd: number | null): Promise<void> {
    await this.reviewRunRepository.update(reviewRunId, {
      consumedUsd: consumedUsd ?? 0,
    });
  }
}
