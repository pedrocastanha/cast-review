import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ArchitectureMap } from '../../entities/architecture-map.entity';
import type { ArchitectureMapVersionRepository } from '../../infrastructure/persistence/architecture-map-version.repository';

export class ListMapVersionsUseCase {
  constructor(
    private readonly versionRepository: ArchitectureMapVersionRepository,
  ) {}

  async execute(map: ArchitectureMap) {
    const versions = await this.versionRepository.find({
      where: { mapId: map.id },
      order: { version: 'DESC' },
    });
    return versions.map((version) => ({
      version: version.version,
      hash: version.hash,
      publishedAt: version.createdAt.toISOString(),
    }));
  }

  async detail(map: ArchitectureMap, version: number) {
    if (!Number.isInteger(version) || version < 1) {
      throw new BadRequestException('Versão inválida.');
    }

    const record = await this.versionRepository.findOne({
      where: { mapId: map.id, version },
    });
    if (!record) {
      throw new NotFoundException('Versão do mapa não encontrada.');
    }

    return {
      mapId: map.id,
      version: record.version,
      hash: record.hash,
      publishedAt: record.createdAt.toISOString(),
      snapshot: record.snapshot,
    };
  }
}
