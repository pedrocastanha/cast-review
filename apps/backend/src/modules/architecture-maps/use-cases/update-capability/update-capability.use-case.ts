import { BadRequestException } from '@nestjs/common';
import type { UpsertCapabilityDto } from '../../dtos/upsert-capability.dto';
import type { ArchitectureCapability } from '../../entities/architecture-capability.entity';
import type { ArchitectureMap } from '../../entities/architecture-map.entity';
import type { ArchitectureCapabilityRepository } from '../../infrastructure/persistence/architecture-capability.repository';
import type { ArchitectureMapOwnershipProvider } from '../shared/architecture-map-ownership.provider';

export class UpdateCapabilityUseCase {
  constructor(
    private readonly ownership: ArchitectureMapOwnershipProvider,
    private readonly capabilityRepository: ArchitectureCapabilityRepository,
  ) {}

  async execute(
    map: ArchitectureMap,
    capabilityId: string,
    input: UpsertCapabilityDto,
  ): Promise<ArchitectureCapability> {
    const capability = await this.ownership.capability(map, capabilityId);
    const name = input.name.trim();

    if (name !== capability.name) {
      const duplicated = await this.capabilityRepository.existsBy({
        mapId: map.id,
        name,
        active: true,
      });
      if (duplicated) {
        throw new BadRequestException(
          'Já existe uma capacidade com esse nome.',
        );
      }
    }

    const description = input.description?.trim() || null;
    await this.capabilityRepository.update(capability.id, {
      name,
      description,
      criticality: input.criticality,
    });

    return Object.assign(capability, {
      name,
      description,
      criticality: input.criticality,
    });
  }
}
