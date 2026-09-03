import { AppLogger } from 'src/shared/logger/logger.service';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import type { InstallationTokenService } from '../../infrastructure/github/installation-token.service';
import type { GithubAppRepositoryRepository } from '../../infrastructure/persistence/github-app-repository.repository';
import type { GithubInstallationRepository } from '../../infrastructure/persistence/github-installation.repository';
import type { InstallationOwnershipProvider } from '../shared/installation-ownership.provider';

export class UnlinkInstallationUseCase {
  constructor(
    private readonly ownership: InstallationOwnershipProvider,
    private readonly installationRepository: GithubInstallationRepository,
    private readonly appRepositoryRepository: GithubAppRepositoryRepository,
    private readonly tokenService: InstallationTokenService,
    private readonly logger: AppLogger,
  ) {}

  async execute(
    installationId: string,
    currentUser: CurrentUserData,
  ): Promise<{ status: 'unlinked' }> {
    const installation = await this.ownership.installation(
      installationId,
      currentUser,
    );

    await this.appRepositoryRepository
      .createQueryBuilder()
      .update()
      .set({ enabled: false, removedAt: new Date() })
      .where('installation_id = :id', { id: installation.id })
      .execute();

    await this.installationRepository.update(installation.id, {
      ownerUserId: null,
      status: 'pending',
      pausedAt: new Date(),
    });

    this.tokenService.forget(installation.installationId);
    this.logger.log('Vínculo local da instalação revogado', {
      installationId: installation.installationId,
    });

    return { status: 'unlinked' };
  }
}
