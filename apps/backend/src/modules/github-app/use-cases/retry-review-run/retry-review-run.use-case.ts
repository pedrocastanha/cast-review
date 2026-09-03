import { ConflictException, NotFoundException } from '@nestjs/common';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import type { GithubReviewRunRepository } from '../../infrastructure/persistence/github-review-run.repository';
import type { EnqueueReviewRunUseCase } from '../enqueue-review-run/enqueue-review-run.use-case';
import type { InstallationOwnershipProvider } from '../shared/installation-ownership.provider';

export class RetryReviewRunUseCase {
  constructor(
    private readonly ownership: InstallationOwnershipProvider,
    private readonly reviewRunRepository: GithubReviewRunRepository,
    private readonly enqueueReviewRun: EnqueueReviewRunUseCase,
  ) {}

  async execute(runId: string, currentUser: CurrentUserData) {
    const run = await this.reviewRunRepository.findOne({ where: { id: runId } });
    if (!run) throw new NotFoundException('Execução não encontrada');

    const { repository, installation } = await this.ownership.repository(
      run.repositoryId,
      currentUser,
    );

    if (run.status === 'queued' || run.status === 'running') {
      throw new ConflictException('Execução ainda em andamento');
    }

    return this.enqueueReviewRun.execute({
      installation,
      repository,
      facts: {
        pullNumber: run.pullNumber,
        headSha: run.headSha,
        baseRef: run.baseRef ?? '',
        owner: run.owner,
        repo: run.repo,
      },
      trigger: 'retry',
      eventAction: run.eventAction,
      deliveryId: run.deliveryId,
    });
  }
}
