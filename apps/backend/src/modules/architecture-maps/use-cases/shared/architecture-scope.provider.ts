import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import type { ProjectsService } from '../../../projects/projects.service';
import type { RepositoriesService } from '../../../repositories/repositories.service';
import type {
  ArchitectureScope,
  ArchitectureScopeRepository,
  ArchitectureScopeType,
} from '../../domain/architecture-maps.types';
import type { ArchitectureMap } from '../../entities/architecture-map.entity';

export class ArchitectureScopeProvider {
  constructor(
    private readonly repositoriesService: RepositoriesService,
    private readonly projectsService: ProjectsService,
  ) {}

  normalizeRef(scopeType: ArchitectureScopeType, scopeRef: string): string {
    const normalized = scopeRef?.trim() ?? '';
    if (!normalized) {
      throw new BadRequestException('scopeRef é obrigatório.');
    }
    if (scopeType === 'repository') {
      if (!normalized.includes('/')) {
        throw new BadRequestException(
          'scopeRef deve usar o formato owner/repo.',
        );
      }
      return normalized.toLowerCase();
    }
    return normalized;
  }

  async assertAccess(
    scopeType: ArchitectureScopeType,
    scopeRef: string,
    currentUser: CurrentUserData,
  ): Promise<void> {
    if (scopeType === 'project') {
      await this.projectsService.getById(scopeRef, currentUser);
      return;
    }

    const repositories = await this.repositoriesService.listRepos(currentUser);
    const authorized = repositories.some(
      (repository) => repository.fullName.toLowerCase() === scopeRef,
    );
    if (!authorized) {
      throw new NotFoundException('Repositório não encontrado.');
    }
  }

  async resolve(
    map: ArchitectureMap,
    currentUser: CurrentUserData,
  ): Promise<ArchitectureScope> {
    const repositories =
      map.scopeType === 'project'
        ? await this.projectRepositories(map.scopeRef, currentUser)
        : [await this.singleRepository(map.scopeRef, currentUser)];

    return {
      scopeType: map.scopeType,
      scopeRef: map.scopeRef,
      repositories,
    };
  }

  private async projectRepositories(
    projectId: string,
    currentUser: CurrentUserData,
  ): Promise<ArchitectureScopeRepository[]> {
    const status = await this.projectsService.getIndexStatus(
      projectId,
      currentUser,
    );
    return status.repositories.map((repository) => ({
      repoId: repository.repository,
      sha: repository.sha,
      status: repository.status,
      stale: repository.stale,
      indexed: repository.status === 'indexed' && Boolean(repository.sha),
    }));
  }

  private async singleRepository(
    repoId: string,
    currentUser: CurrentUserData,
  ): Promise<ArchitectureScopeRepository> {
    const [owner, repo] = repoId.split('/');
    try {
      const status = await this.repositoriesService.getRepositoryIndexStatus(
        repo,
        currentUser,
        owner,
      );
      return {
        repoId,
        sha: status.sha,
        status: status.status,
        stale: status.stale,
        indexed: status.status === 'indexed' && Boolean(status.sha),
      };
    } catch {
      return {
        repoId,
        sha: null,
        status: 'error',
        stale: false,
        indexed: false,
      };
    }
  }
}
