import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import type { DeclareBoundaryDto } from '../../dtos/declare-boundary.dto';
import type { ArchitectureBoundary } from '../../entities/architecture-boundary.entity';
import type { ArchitectureMap } from '../../entities/architecture-map.entity';
import type { ArchitectureBoundaryRepository } from '../../infrastructure/persistence/architecture-boundary.repository';
import type { ArchitectureMapOwnershipProvider } from '../shared/architecture-map-ownership.provider';

export class DeclareBoundaryUseCase {
  constructor(
    private readonly ownership: ArchitectureMapOwnershipProvider,
    private readonly boundaryRepository: ArchitectureBoundaryRepository,
  ) {}

  async execute(
    map: ArchitectureMap,
    input: DeclareBoundaryDto,
  ): Promise<ArchitectureBoundary> {
    if (input.fromCapabilityId === input.toCapabilityId) {
      throw new BadRequestException(
        'Uma fronteira precisa ligar capacidades diferentes.',
      );
    }
    await this.ownership.capability(map, input.fromCapabilityId);
    await this.ownership.capability(map, input.toCapabilityId);

    const note = input.note?.trim() || null;
    const existing = await this.boundaryRepository.findOne({
      where: {
        mapId: map.id,
        fromCapabilityId: input.fromCapabilityId,
        toCapabilityId: input.toCapabilityId,
        active: true,
      },
    });

    if (existing) {
      await this.boundaryRepository.update(existing.id, {
        kind: input.kind,
        note,
      });
      return Object.assign(existing, { kind: input.kind, note });
    }

    return this.boundaryRepository.save(
      this.boundaryRepository.create({
        id: randomUUID(),
        mapId: map.id,
        fromCapabilityId: input.fromCapabilityId,
        toCapabilityId: input.toCapabilityId,
        kind: input.kind,
        note,
      }),
    );
  }
}
