import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import type { GithubReviewRunRepository } from '../../infrastructure/persistence/github-review-run.repository';
import type { InstallationOwnershipProvider } from '../shared/installation-ownership.provider';
import { toReviewRunSummary } from '../shared/installation-presenter';

const PAGE_SIZE = 50;

export class ListReviewRunsUseCase {
  constructor(
    private readonly ownership: InstallationOwnershipProvider,
    private readonly reviewRunRepository: GithubReviewRunRepository,
  ) {}

  async execute(repositoryId: string, currentUser: CurrentUserData) {
    const { repository } = await this.ownership.repository(
      repositoryId,
      currentUser,
    );

    const runs = await this.reviewRunRepository.find({
      where: { repositoryId: repository.id },
      order: { queuedAt: 'DESC' },
      take: PAGE_SIZE,
    });

    return runs.map(toReviewRunSummary);
  }
}
