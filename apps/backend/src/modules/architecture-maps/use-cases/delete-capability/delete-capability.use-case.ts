import type { ArchitectureMap } from '../../entities/architecture-map.entity';
import type { ArchitectureBoundaryRepository } from '../../infrastructure/persistence/architecture-boundary.repository';
import type { ArchitectureCapabilityRepository } from '../../infrastructure/persistence/architecture-capability.repository';
import type { ArchitectureComponentRepository } from '../../infrastructure/persistence/architecture-component.repository';
import type { ArchitectureMapOwnershipProvider } from '../shared/architecture-map-ownership.provider';

export class DeleteCapabilityUseCase {
  constructor(
    private readonly ownership: ArchitectureMapOwnershipProvider,
    private readonly capabilityRepository: ArchitectureCapabilityRepository,
    private readonly componentRepository: ArchitectureComponentRepository,
    private readonly boundaryRepository: ArchitectureBoundaryRepository,
  ) {}

  async execute(map: ArchitectureMap, capabilityId: string) {
    const capability = await this.ownership.capability(map, capabilityId);

    return this.capabilityRepository.datasource.transaction(async (manager) => {
      const owned = await this.componentRepository.find(
        { where: { mapId: map.id, capabilityId: capability.id, active: true } },
        manager,
      );
      for (const component of owned) {
        await this.componentRepository.update(
          component.id,
          { capabilityId: null, status: 'unmapped', confidence: 'inferred' },
          manager,
        );
      }
      await this.boundaryRepository.delete(
        { mapId: map.id, fromCapabilityId: capability.id },
        manager,
      );
      await this.boundaryRepository.delete(
        { mapId: map.id, toCapabilityId: capability.id },
        manager,
      );
      await this.capabilityRepository.delete({ id: capability.id }, manager);

      return { id: capability.id, releasedComponents: owned.length };
    });
  }
}
