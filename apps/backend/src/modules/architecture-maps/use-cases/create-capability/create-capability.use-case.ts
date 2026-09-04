import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { UpsertCapabilityDto } from '../../dtos/upsert-capability.dto';
import type { ArchitectureCapability } from '../../entities/architecture-capability.entity';
import type { ArchitectureMap } from '../../entities/architecture-map.entity';
import type { ArchitectureCapabilityRepository } from '../../infrastructure/persistence/architecture-capability.repository';

export class CreateCapabilityUseCase {
  constructor(
    private readonly capabilityRepository: ArchitectureCapabilityRepository,
  ) {}

  async execute(
    map: ArchitectureMap,
    input: UpsertCapabilityDto,
  ): Promise<ArchitectureCapability> {
    const name = input.name.trim();
    const duplicated = await this.capabilityRepository.existsBy({
      mapId: map.id,
      name,
      active: true,
    });
    if (duplicated) {
      throw new BadRequestException('Já existe uma capacidade com esse nome.');
    }

    return this.capabilityRepository.save(
      this.capabilityRepository.create({
        id: randomUUID(),
        mapId: map.id,
        name,
        description: input.description?.trim() || null,
        criticality: input.criticality,
      }),
    );
  }
}
