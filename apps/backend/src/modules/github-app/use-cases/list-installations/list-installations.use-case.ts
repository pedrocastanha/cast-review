import { IsNull } from 'typeorm';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import type { GithubAppRepositoryRepository } from '../../infrastructure/persistence/github-app-repository.repository';
import type { GithubInstallationRepository } from '../../infrastructure/persistence/github-installation.repository';
import {
  toInstallationSummary,
  toRepositorySummary,
} from '../shared/installation-presenter';

export class ListInstallationsUseCase {
  constructor(
    private readonly installationRepository: GithubInstallationRepository,
    private readonly appRepositoryRepository: GithubAppRepositoryRepository,
  ) {}

  async execute(currentUser: CurrentUserData) {
    const installations = await this.installationRepository.find({
      where: { ownerUserId: currentUser.id },
      order: { createdAt: 'DESC' },
    });

    return Promise.all(
      installations.map(async (installation) => ({
        ...toInstallationSummary(installation),
        repositories: (
          await this.appRepositoryRepository.find({
            where: { installationId: installation.id, removedAt: IsNull() },
            order: { fullName: 'ASC' },
          })
        ).map(toRepositorySummary),
      })),
    );
  }
}
