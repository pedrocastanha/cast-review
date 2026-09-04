import { Injectable } from '@nestjs/common';
import { AiApiClient } from 'src/shared/clients/ai/ai-api.client';
import { AppLogger } from 'src/shared/logger/logger.service';
import type {
  ArchitectureCandidatesResult,
  ArchitectureChangedFile,
  ArchitectureComponentDependency,
  ArchitectureComponentRef,
  ArchitectureImpactResult,
  ArchitectureRepositoryRef,
} from 'src/shared/types';
import type { ArchitectureComponent } from '../../entities/architecture-component.entity';
import type { ArchitectureScope } from '../../domain/architecture-maps.types';

@Injectable()
export class ArchitectureGraphGateway {
  constructor(
    private readonly aiApiClient: AiApiClient,
    private readonly logger: AppLogger,
  ) {}

  usableRepositories(scope: ArchitectureScope): ArchitectureRepositoryRef[] {
    return scope.repositories
      .filter((repository) => repository.indexed && repository.sha)
      .map((repository) => ({
        repoId: repository.repoId,
        sha: repository.sha,
      }));
  }

  toComponentRefs(
    components: ArchitectureComponent[],
  ): ArchitectureComponentRef[] {
    return components.map((component) => ({
      componentId: component.id,
      repoId: component.repoId,
      pathPrefix: component.pathPrefix,
    }));
  }

  candidates(scope: ArchitectureScope): Promise<ArchitectureCandidatesResult> {
    return this.aiApiClient.getArchitectureCandidates(
      this.usableRepositories(scope),
    );
  }

  async dependencies(
    scope: ArchitectureScope,
    components: ArchitectureComponent[],
  ): Promise<{
    dependencies: ArchitectureComponentDependency[];
    available: boolean;
  }> {
    const repositories = this.usableRepositories(scope);
    if (repositories.length === 0 || components.length === 0) {
      return { dependencies: [], available: repositories.length > 0 };
    }

    try {
      const result = await this.aiApiClient.getArchitectureDependencies(
        repositories,
        this.toComponentRefs(components),
      );
      return { dependencies: result.dependencies, available: true };
    } catch (err) {
      this.logger.warn('Dependências arquiteturais indisponíveis', {
        exception: err,
        scopeRef: scope.scopeRef,
      });
      return { dependencies: [], available: false };
    }
  }

  impact(
    scope: ArchitectureScope,
    components: ArchitectureComponent[],
    changedFiles: ArchitectureChangedFile[],
  ): Promise<ArchitectureImpactResult> {
    return this.aiApiClient.getArchitectureImpact(
      this.usableRepositories(scope),
      this.toComponentRefs(components),
      changedFiles,
    );
  }
}
