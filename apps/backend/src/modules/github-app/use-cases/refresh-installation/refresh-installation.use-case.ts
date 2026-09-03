import { AppLogger } from 'src/shared/logger/logger.service';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import type { InstallationTokenService } from '../../infrastructure/github/installation-token.service';
import type { GithubInstallationRepository } from '../../infrastructure/persistence/github-installation.repository';
import type { InstallationOwnershipProvider } from '../shared/installation-ownership.provider';
import type { SyncRepositoriesUseCase } from '../sync-repositories/sync-repositories.use-case';

export class RefreshInstallationUseCase {
  constructor(
    private readonly ownership: InstallationOwnershipProvider,
    private readonly installationRepository: GithubInstallationRepository,
    private readonly tokenService: InstallationTokenService,
    private readonly syncRepositories: SyncRepositoriesUseCase,
    private readonly logger: AppLogger,
  ) {}

  async execute(
    installationId: string,
    currentUser: CurrentUserData,
  ): Promise<string> {
    const installation = await this.ownership.installation(
      installationId,
      currentUser,
    );

    const octokit = this.tokenService.appClient();
    const { data } = await octokit.apps.getInstallation({
      installation_id: Number(installation.installationId),
    });
    const account = data.account as { login?: string; slug?: string } | null;

    await this.installationRepository.update(installation.id, {
      accountLogin: account?.login ?? account?.slug ?? installation.accountLogin,
      repositorySelection: data.repository_selection ?? null,
      permissions: (data.permissions ?? {}) as Record<string, string>,
      events: data.events ?? [],
      status: data.suspended_at
        ? 'suspended'
        : installation.status === 'deleted'
          ? 'deleted'
          : 'active',
    });

    await this.syncRepositories.execute(installation);
    this.logger.log('Instalação ressincronizada', {
      installationId: installation.installationId,
    });

    return installation.id;
  }
}
