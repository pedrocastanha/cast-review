import { randomUUID } from 'node:crypto';
import type { GithubInstallation } from '../../entities/github-installation.entity';
import { defaultRepositoryConfig } from '../../domain/github-app.types';
import type { InstallationTokenService } from '../../infrastructure/github/installation-token.service';
import type { GithubAppRepositoryRepository } from '../../infrastructure/persistence/github-app-repository.repository';

interface RemoteRepository {
  id: number;
  name: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  owner: { login: string };
}

export class SyncRepositoriesUseCase {
  constructor(
    private readonly appRepositoryRepository: GithubAppRepositoryRepository,
    private readonly tokenService: InstallationTokenService,
  ) {}

  async execute(installation: GithubInstallation): Promise<void> {
    const octokit = await this.tokenService.clientFor(
      installation.installationId,
    );
    const remote = (await octokit.paginate(
      octokit.apps.listReposAccessibleToInstallation,
      { per_page: 100 },
    )) as unknown as RemoteRepository[];

    const seen = new Set<string>();

    for (const repository of remote) {
      const githubRepoId = String(repository.id);
      seen.add(githubRepoId);

      const existing = await this.appRepositoryRepository.findOne({
        where: { installationId: installation.id, githubRepoId },
      });

      await this.appRepositoryRepository.save({
        ...(existing ?? {}),
        id: existing?.id ?? randomUUID(),
        installationId: installation.id,
        githubRepoId,
        owner: repository.owner.login,
        repo: repository.name,
        fullName: repository.full_name,
        isPrivate: repository.private,
        defaultBranch: repository.default_branch,
        enabled: existing?.enabled ?? false,
        config: existing?.config ?? defaultRepositoryConfig(),
        configStatus: existing?.configStatus ?? 'configuration_required',
        configReason: existing?.configReason ?? null,
        removedAt: null,
      });
    }

    const stored = await this.appRepositoryRepository.find({
      where: { installationId: installation.id },
    });
    for (const repository of stored) {
      if (!repository.removedAt && !seen.has(repository.githubRepoId)) {
        await this.appRepositoryRepository.update(repository.id, {
          enabled: false,
          removedAt: new Date(),
        });
      }
    }
  }
}
