import { NotFoundException } from '@nestjs/common';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import type { ArchitectureBoundary } from '../../entities/architecture-boundary.entity';
import type { ArchitectureCapability } from '../../entities/architecture-capability.entity';
import type { ArchitectureComponent } from '../../entities/architecture-component.entity';
import type { ArchitectureMap } from '../../entities/architecture-map.entity';
import type { ArchitectureBoundaryRepository } from '../../infrastructure/persistence/architecture-boundary.repository';
import type { ArchitectureCapabilityRepository } from '../../infrastructure/persistence/architecture-capability.repository';
import type { ArchitectureComponentRepository } from '../../infrastructure/persistence/architecture-component.repository';
import type { ArchitectureMapRepository } from '../../infrastructure/persistence/architecture-map.repository';

export class ArchitectureMapOwnershipProvider {
  constructor(
    private readonly mapRepository: ArchitectureMapRepository,
    private readonly capabilityRepository: ArchitectureCapabilityRepository,
    private readonly componentRepository: ArchitectureComponentRepository,
    private readonly boundaryRepository: ArchitectureBoundaryRepository,
  ) {}

  async map(
    mapId: string,
    currentUser: CurrentUserData,
  ): Promise<ArchitectureMap> {
    const map = await this.mapRepository.findOne({
      where: { id: mapId, ownerId: currentUser.id, active: true },
    });
    if (!map) {
      throw new NotFoundException('Mapa arquitetural não encontrado.');
    }
    return map;
  }

  async capability(
    map: ArchitectureMap,
    capabilityId: string,
  ): Promise<ArchitectureCapability> {
    const capability = await this.capabilityRepository.findOne({
      where: { id: capabilityId, mapId: map.id, active: true },
    });
    if (!capability) {
      throw new NotFoundException('Capacidade não encontrada.');
    }
    return capability;
  }

  async component(
    map: ArchitectureMap,
    componentId: string,
  ): Promise<ArchitectureComponent> {
    const component = await this.componentRepository.findOne({
      where: { id: componentId, mapId: map.id, active: true },
    });
    if (!component) {
      throw new NotFoundException('Componente não encontrado.');
    }
    return component;
  }

  async boundary(
    map: ArchitectureMap,
    boundaryId: string,
  ): Promise<ArchitectureBoundary> {
    const boundary = await this.boundaryRepository.findOne({
      where: { id: boundaryId, mapId: map.id, active: true },
    });
    if (!boundary) {
      throw new NotFoundException('Fronteira não encontrada.');
    }
    return boundary;
  }
}
