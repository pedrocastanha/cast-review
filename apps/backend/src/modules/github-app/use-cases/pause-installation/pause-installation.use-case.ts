import { AppLogger } from 'src/shared/logger/logger.service';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import type { GithubInstallationRepository } from '../../infrastructure/persistence/github-installation.repository';
import type { InstallationOwnershipProvider } from '../shared/installation-ownership.provider';

export class PauseInstallationUseCase {
  constructor(
    private readonly ownership: InstallationOwnershipProvider,
    private readonly installationRepository: GithubInstallationRepository,
    private readonly logger: AppLogger,
  ) {}

  async execute(
    installationId: string,
    currentUser: CurrentUserData,
    paused: boolean,
  ): Promise<string> {
    const installation = await this.ownership.installation(
      installationId,
      currentUser,
    );

    await this.installationRepository.update(installation.id, {
      pausedAt: paused ? new Date() : null,
    });

    this.logger.log('Instalação pausada/retomada', {
      installationId: installation.installationId,
      paused,
    });

    return installation.id;
  }
}
