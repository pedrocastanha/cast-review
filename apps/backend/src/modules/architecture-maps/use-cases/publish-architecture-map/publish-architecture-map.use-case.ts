import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { canonicalMapHash } from '../../domain/map-hash';
import type { ArchitectureMap } from '../../entities/architecture-map.entity';
import type { ArchitectureMapRepository } from '../../infrastructure/persistence/architecture-map.repository';
import type { ArchitectureMapVersionRepository } from '../../infrastructure/persistence/architecture-map-version.repository';
import type { ArchitectureView } from '../build-architecture-view/build-architecture-view.use-case';

export class PublishArchitectureMapUseCase {
  constructor(
    private readonly mapRepository: ArchitectureMapRepository,
    private readonly versionRepository: ArchitectureMapVersionRepository,
  ) {}

  async execute(map: ArchitectureMap, view: ArchitectureView, actorId: string) {
    if (view.coverage.assignedComponents === 0) {
      throw new BadRequestException(
        'Associe ao menos um componente a uma capacidade antes de publicar.',
      );
    }

    const hash = canonicalMapHash({
      capabilities: view.capabilities,
      components: view.components,
      boundaries: view.boundaries,
      repositories: view.scope.repositories,
    });
    const version = (map.publishedVersion ?? 0) + 1;

    return this.mapRepository.datasource.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`architecture-map|${map.id}`],
      );

      const published = await this.versionRepository.save(
        this.versionRepository.create(
          {
            id: randomUUID(),
            mapId: map.id,
            version,
            hash,
            snapshot: {
              capabilities: view.capabilities,
              components: view.components,
              dependencies: view.dependencies,
              boundaries: view.boundaries,
              violations: view.violations,
              coverage: view.coverage,
              scope: view.scope,
            },
            publishedBy: actorId,
          },
          manager,
        ),
        undefined,
        manager,
      );

      const publishedAt = new Date();
      await this.mapRepository.update(
        map.id,
        { publishedVersion: version, publishedHash: hash, publishedAt },
        manager,
      );

      return {
        mapId: map.id,
        version: published.version,
        hash: published.hash,
        publishedAt: publishedAt.toISOString(),
      };
    });
  }
}
