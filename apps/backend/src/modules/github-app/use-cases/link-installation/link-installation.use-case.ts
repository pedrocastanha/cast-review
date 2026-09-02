import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { AppLogger } from 'src/shared/logger/logger.service';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import type { LinkInstallationDto } from '../../dtos/link-installation.dto';
import {
  isGithubAppConfigured,
  resolveGithubAppConfig,
} from '../../config/github-app.config';
import {
  createInstallState,
  verifyInstallState,
} from '../../infrastructure/github/security/install-state';
import type { InstallationTokenService } from '../../infrastructure/github/installation-token.service';
import type { GithubInstallationRepository } from '../../infrastructure/persistence/github-installation.repository';
import type { SyncRepositoriesUseCase } from '../sync-repositories/sync-repositories.use-case';

export class LinkInstallationUseCase {
  constructor(
    private readonly installationRepository: GithubInstallationRepository,
    private readonly tokenService: InstallationTokenService,
    private readonly syncRepositories: SyncRepositoriesUseCase,
    private readonly logger: AppLogger,
  ) {}

  installUrl(currentUser: CurrentUserData): { url: string; state: string } {
    const config = resolveGithubAppConfig();
    if (!isGithubAppConfigured(config)) {
      throw new BadRequestException(
        'GitHub App não configurada neste ambiente. Defina GITHUB_APP_ID, GITHUB_APP_SLUG, GITHUB_APP_PRIVATE_KEY e GITHUB_APP_WEBHOOK_SECRET.',
      );
    }
    const state = createInstallState(config.stateSecret, currentUser.id);
    return {
      url: `https://github.com/apps/${config.slug}/installations/new?state=${encodeURIComponent(state)}`,
      state,
    };
  }

  async execute(
    currentUser: CurrentUserData,
    input: LinkInstallationDto,
  ): Promise<string> {
    const config = resolveGithubAppConfig();
    const state = verifyInstallState(config.stateSecret, input.state);
    if (!state || state.userId !== currentUser.id) {
      throw new BadRequestException(
        'Vínculo da instalação inválido ou expirado',
      );
    }

    const remote = await this.fetchInstallation(input.installationId);
    const existing = await this.installationRepository.findOne({
      where: { installationId: input.installationId },
    });

    if (
      existing &&
      existing.ownerUserId &&
      existing.ownerUserId !== currentUser.id
    ) {
      throw new BadRequestException(
        'Esta instalação já está vinculada a outro usuário do Cast',
      );
    }

    const saved = await this.installationRepository.save({
      ...(existing ?? {}),
      id: existing?.id ?? randomUUID(),
      installationId: input.installationId,
      accountLogin: remote.accountLogin,
      accountType: remote.accountType,
      accountId: remote.accountId,
      ownerUserId: currentUser.id,
      status: remote.suspended ? 'suspended' : 'active',
      repositorySelection: remote.repositorySelection,
      permissions: remote.permissions,
      events: remote.events,
      suspendedAt: remote.suspended ? new Date() : null,
      pausedAt: existing?.pausedAt ?? null,
      linkedAt: new Date(),
    });

    await this.syncRepositories.execute(saved);

    this.logger.log('Instalação vinculada', {
      installationId: input.installationId,
      userId: currentUser.id,
    });

    return saved.id;
  }

  private async fetchInstallation(installationId: string) {
    const octokit = this.tokenService.appClient();
    const { data } = await octokit.apps.getInstallation({
      installation_id: Number(installationId),
    });
    const account = data.account as
      | { login?: string; type?: string; id?: number; slug?: string }
      | null;
    return {
      accountLogin: account?.login ?? account?.slug ?? '',
      accountType: account?.type ?? 'Organization',
      accountId: account?.id ? String(account.id) : null,
      repositorySelection: data.repository_selection ?? null,
      permissions: (data.permissions ?? {}) as Record<string, string>,
      events: data.events ?? [],
      suspended: Boolean(data.suspended_at),
    };
  }
}
