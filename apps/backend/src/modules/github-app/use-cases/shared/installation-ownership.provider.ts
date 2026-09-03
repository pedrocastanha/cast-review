import { NotFoundException } from '@nestjs/common';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import type { GithubAppRepository } from '../../entities/github-app-repository.entity';
import type { GithubInstallation } from '../../entities/github-installation.entity';
import type { GithubAppRepositoryRepository } from '../../infrastructure/persistence/github-app-repository.repository';
import type { GithubInstallationRepository } from '../../infrastructure/persistence/github-installation.repository';

export class InstallationOwnershipProvider {
  constructor(
    private readonly installationRepository: GithubInstallationRepository,
    private readonly appRepositoryRepository: GithubAppRepositoryRepository,
  ) {}

  async installation(
    installationId: string,
    currentUser: CurrentUserData,
  ): Promise<GithubInstallation> {
    const installation = await this.installationRepository.findOne({
      where: { id: installationId, ownerUserId: currentUser.id },
    });
    if (!installation) {
      throw new NotFoundException('Instalação não encontrada');
    }
    return installation;
  }

  async repository(
    repositoryId: string,
    currentUser: CurrentUserData,
  ): Promise<{
    repository: GithubAppRepository;
    installation: GithubInstallation;
  }> {
    const repository = await this.appRepositoryRepository.findOne({
      where: { id: repositoryId },
    });
    if (!repository) {
      throw new NotFoundException('Repositório não encontrado na instalação');
    }
    const installation = await this.installation(
      repository.installationId,
      currentUser,
    );
    return { repository, installation };
  }
}
