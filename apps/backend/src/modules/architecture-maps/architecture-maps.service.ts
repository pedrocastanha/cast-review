import { Inject, Injectable } from '@nestjs/common';
import { AppLogger } from 'src/shared/logger/logger.service';
import { BaseService } from 'src/shared/services/base.service';
import type { ArchitectureChangedFile } from 'src/shared/types';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { ProjectsService } from '../projects/projects.service';
import { RepositoriesService } from '../repositories/repositories.service';
import type {
  ArchitectureImpact,
  ArchitectureScopeType,
} from './domain/architecture-maps.types';
import type { AssignComponentDto } from './dtos/assign-component.dto';
import type { CreateArchitectureMapDto } from './dtos/create-architecture-map.dto';
import type { DeclareBoundaryDto } from './dtos/declare-boundary.dto';
import type { UpsertCapabilityDto } from './dtos/upsert-capability.dto';
import { ArchitectureGraphGateway } from './infrastructure/ai/architecture-graph.gateway';
import { ArchitectureBoundaryRepository } from './infrastructure/persistence/architecture-boundary.repository';
import { ArchitectureCapabilityRepository } from './infrastructure/persistence/architecture-capability.repository';
import { ArchitectureComponentRepository } from './infrastructure/persistence/architecture-component.repository';
import { ArchitectureMapRepository } from './infrastructure/persistence/architecture-map.repository';
import { ArchitectureMapVersionRepository } from './infrastructure/persistence/architecture-map-version.repository';
import { AssignComponentUseCase } from './use-cases/assign-component/assign-component.use-case';
import { BuildArchitectureViewUseCase } from './use-cases/build-architecture-view/build-architecture-view.use-case';
import { CreateArchitectureMapUseCase } from './use-cases/create-architecture-map/create-architecture-map.use-case';
import { CreateCapabilityUseCase } from './use-cases/create-capability/create-capability.use-case';
import { DeclareBoundaryUseCase } from './use-cases/declare-boundary/declare-boundary.use-case';
import { DeleteBoundaryUseCase } from './use-cases/delete-boundary/delete-boundary.use-case';
import { DeleteCapabilityUseCase } from './use-cases/delete-capability/delete-capability.use-case';
import { ListArchitectureMapsUseCase } from './use-cases/list-architecture-maps/list-architecture-maps.use-case';
import { ListMapVersionsUseCase } from './use-cases/list-map-versions/list-map-versions.use-case';
import { PublishArchitectureMapUseCase } from './use-cases/publish-architecture-map/publish-architecture-map.use-case';
import { ResolveArchitectureImpactUseCase } from './use-cases/resolve-architecture-impact/resolve-architecture-impact.use-case';
import { ArchitectureMapOwnershipProvider } from './use-cases/shared/architecture-map-ownership.provider';
import { ArchitectureScopeProvider } from './use-cases/shared/architecture-scope.provider';
import { SuggestComponentsUseCase } from './use-cases/suggest-components/suggest-components.use-case';
import { UpdateCapabilityUseCase } from './use-cases/update-capability/update-capability.use-case';

@Injectable()
export class ArchitectureMapsService extends BaseService {
  private readonly ownership: ArchitectureMapOwnershipProvider;
  private readonly scope: ArchitectureScopeProvider;
  private readonly listMapsUseCase: ListArchitectureMapsUseCase;
  private readonly createMapUseCase: CreateArchitectureMapUseCase;
  private readonly buildViewUseCase: BuildArchitectureViewUseCase;
  private readonly suggestComponentsUseCase: SuggestComponentsUseCase;
  private readonly createCapabilityUseCase: CreateCapabilityUseCase;
  private readonly updateCapabilityUseCase: UpdateCapabilityUseCase;
  private readonly deleteCapabilityUseCase: DeleteCapabilityUseCase;
  private readonly assignComponentUseCase: AssignComponentUseCase;
  private readonly declareBoundaryUseCase: DeclareBoundaryUseCase;
  private readonly deleteBoundaryUseCase: DeleteBoundaryUseCase;
  private readonly publishMapUseCase: PublishArchitectureMapUseCase;
  private readonly listVersionsUseCase: ListMapVersionsUseCase;
  private readonly resolveImpactUseCase: ResolveArchitectureImpactUseCase;

  constructor(
    mapRepository: ArchitectureMapRepository,
    versionRepository: ArchitectureMapVersionRepository,
    capabilityRepository: ArchitectureCapabilityRepository,
    componentRepository: ArchitectureComponentRepository,
    boundaryRepository: ArchitectureBoundaryRepository,
    graphGateway: ArchitectureGraphGateway,
    @Inject('REPOSITORIES_SERVICE')
    repositoriesService: RepositoriesService,
    @Inject('PROJECTS_SERVICE')
    projectsService: ProjectsService,
    logger: AppLogger,
  ) {
    super(logger);

    this.ownership = new ArchitectureMapOwnershipProvider(
      mapRepository,
      capabilityRepository,
      componentRepository,
      boundaryRepository,
    );
    this.scope = new ArchitectureScopeProvider(
      repositoriesService,
      projectsService,
    );
    this.listMapsUseCase = new ListArchitectureMapsUseCase(
      mapRepository,
      this.scope,
    );
    this.createMapUseCase = new CreateArchitectureMapUseCase(
      mapRepository,
      this.scope,
    );
    this.buildViewUseCase = new BuildArchitectureViewUseCase(
      capabilityRepository,
      componentRepository,
      boundaryRepository,
      graphGateway,
    );
    this.suggestComponentsUseCase = new SuggestComponentsUseCase(
      componentRepository,
      graphGateway,
    );
    this.createCapabilityUseCase = new CreateCapabilityUseCase(
      capabilityRepository,
    );
    this.updateCapabilityUseCase = new UpdateCapabilityUseCase(
      this.ownership,
      capabilityRepository,
    );
    this.deleteCapabilityUseCase = new DeleteCapabilityUseCase(
      this.ownership,
      capabilityRepository,
      componentRepository,
      boundaryRepository,
    );
    this.assignComponentUseCase = new AssignComponentUseCase(
      this.ownership,
      componentRepository,
    );
    this.declareBoundaryUseCase = new DeclareBoundaryUseCase(
      this.ownership,
      boundaryRepository,
    );
    this.deleteBoundaryUseCase = new DeleteBoundaryUseCase(
      this.ownership,
      boundaryRepository,
    );
    this.publishMapUseCase = new PublishArchitectureMapUseCase(
      mapRepository,
      versionRepository,
    );
    this.listVersionsUseCase = new ListMapVersionsUseCase(versionRepository);
    this.resolveImpactUseCase = new ResolveArchitectureImpactUseCase(
      versionRepository,
      graphGateway,
    );
  }

  list(currentUser: CurrentUserData) {
    return this.listMapsUseCase.execute(currentUser);
  }

  findForScope(
    scopeType: ArchitectureScopeType,
    scopeRef: string,
    currentUser: CurrentUserData,
  ) {
    return this.listMapsUseCase.forScope(scopeType, scopeRef, currentUser);
  }

  create(input: CreateArchitectureMapDto, currentUser: CurrentUserData) {
    return this.createMapUseCase.execute(input, currentUser);
  }

  async getView(mapId: string, currentUser: CurrentUserData) {
    const map = await this.ownership.map(mapId, currentUser);
    return this.buildViewUseCase.execute(
      map,
      await this.scope.resolve(map, currentUser),
    );
  }

  async suggestComponents(mapId: string, currentUser: CurrentUserData) {
    const map = await this.ownership.map(mapId, currentUser);
    const result = await this.suggestComponentsUseCase.execute(
      map,
      await this.scope.resolve(map, currentUser),
    );
    this.logger.log('Componentes sugeridos para o mapa arquitetural', {
      mapId: map.id,
      created: result.created,
      refreshed: result.refreshed,
    });
    return result;
  }

  async createCapability(
    mapId: string,
    input: UpsertCapabilityDto,
    currentUser: CurrentUserData,
  ) {
    return this.createCapabilityUseCase.execute(
      await this.ownership.map(mapId, currentUser),
      input,
    );
  }

  async updateCapability(
    mapId: string,
    capabilityId: string,
    input: UpsertCapabilityDto,
    currentUser: CurrentUserData,
  ) {
    return this.updateCapabilityUseCase.execute(
      await this.ownership.map(mapId, currentUser),
      capabilityId,
      input,
    );
  }

  async deleteCapability(
    mapId: string,
    capabilityId: string,
    currentUser: CurrentUserData,
  ) {
    return this.deleteCapabilityUseCase.execute(
      await this.ownership.map(mapId, currentUser),
      capabilityId,
    );
  }

  async assignComponent(
    mapId: string,
    componentId: string,
    input: AssignComponentDto,
    currentUser: CurrentUserData,
  ) {
    return this.assignComponentUseCase.execute(
      await this.ownership.map(mapId, currentUser),
      componentId,
      input,
    );
  }

  async declareBoundary(
    mapId: string,
    input: DeclareBoundaryDto,
    currentUser: CurrentUserData,
  ) {
    return this.declareBoundaryUseCase.execute(
      await this.ownership.map(mapId, currentUser),
      input,
    );
  }

  async deleteBoundary(
    mapId: string,
    boundaryId: string,
    currentUser: CurrentUserData,
  ) {
    return this.deleteBoundaryUseCase.execute(
      await this.ownership.map(mapId, currentUser),
      boundaryId,
    );
  }

  async publish(mapId: string, currentUser: CurrentUserData) {
    const map = await this.ownership.map(mapId, currentUser);
    const view = await this.buildViewUseCase.execute(
      map,
      await this.scope.resolve(map, currentUser),
    );
    return this.publishMapUseCase.execute(map, view, currentUser.id);
  }

  async listVersions(mapId: string, currentUser: CurrentUserData) {
    return this.listVersionsUseCase.execute(
      await this.ownership.map(mapId, currentUser),
    );
  }

  async getVersion(
    mapId: string,
    version: number,
    currentUser: CurrentUserData,
  ) {
    return this.listVersionsUseCase.detail(
      await this.ownership.map(mapId, currentUser),
      version,
    );
  }

  async resolveImpactForAnalysis(
    scopeType: ArchitectureScopeType,
    scopeRef: string,
    changedFiles: ArchitectureChangedFile[],
    currentUser: CurrentUserData,
  ): Promise<ArchitectureImpact | null> {
    try {
      const map = await this.findForScope(scopeType, scopeRef, currentUser);
      if (!map) return null;

      const scope = await this.scope.resolve(map, currentUser);
      const draft = await this.buildViewUseCase.execute(map, scope);
      return await this.resolveImpactUseCase.execute(
        map,
        scope,
        draft,
        changedFiles,
      );
    } catch (err) {
      this.logger.warn('Impacto arquitetural indisponível para a análise', {
        exception: err,
        scopeType,
        scopeRef,
      });
      return null;
    }
  }
}
