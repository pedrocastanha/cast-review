import { IsNull } from 'typeorm';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import type { GithubAppRepositoryRepository } from '../../infrastructure/persistence/github-app-repository.repository';
import type { ReserveBudgetUseCase } from '../reserve-budget/reserve-budget.use-case';
import type { InstallationOwnershipProvider } from '../shared/installation-ownership.provider';
import {
  toInstallationSummary,
  toRepositorySummary,
} from '../shared/installation-presenter';

export class GetInstallationUseCase {
  constructor(
    private readonly ownership: InstallationOwnershipProvider,
    private readonly appRepositoryRepository: GithubAppRepositoryRepository,
    private readonly budget: ReserveBudgetUseCase,
  ) {}

  async execute(installationId: string, currentUser: CurrentUserData) {
    const installation = await this.ownership.installation(
      installationId,
      currentUser,
    );
    const repositories = await this.appRepositoryRepository.find({
      where: { installationId: installation.id, removedAt: IsNull() },
      order: { fullName: 'ASC' },
    });

    return {
      ...toInstallationSummary(installation),
      repositories: await Promise.all(
        repositories.map(async (repository) => ({
          ...toRepositorySummary(repository),
          budget: await this.budget.usage(repository),
        })),
      ),
    };
  }
}
