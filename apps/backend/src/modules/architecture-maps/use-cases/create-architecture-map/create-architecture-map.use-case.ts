import { randomUUID } from 'node:crypto';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import type { ArchitectureScopeType } from '../../domain/architecture-maps.types';
import type { CreateArchitectureMapDto } from '../../dtos/create-architecture-map.dto';
import type { ArchitectureMap } from '../../entities/architecture-map.entity';
import type { ArchitectureMapRepository } from '../../infrastructure/persistence/architecture-map.repository';
import type { ArchitectureScopeProvider } from '../shared/architecture-scope.provider';

export class CreateArchitectureMapUseCase {
  constructor(
    private readonly mapRepository: ArchitectureMapRepository,
    private readonly scope: ArchitectureScopeProvider,
  ) {}

  async execute(
    input: CreateArchitectureMapDto,
    currentUser: CurrentUserData,
  ): Promise<ArchitectureMap> {
    const scopeRef = this.scope.normalizeRef(input.scopeType, input.scopeRef);
    await this.scope.assertAccess(input.scopeType, scopeRef, currentUser);

    const existing = await this.mapRepository.findOne({
      where: {
        ownerId: currentUser.id,
        scopeType: input.scopeType,
        scopeRef,
        active: true,
      },
    });
    if (existing) return existing;

    return this.mapRepository.save(
      this.mapRepository.create({
        id: randomUUID(),
        ownerId: currentUser.id,
        scopeType: input.scopeType,
        scopeRef,
        name: input.name?.trim() || this.defaultName(input.scopeType, scopeRef),
        publishedVersion: null,
        publishedHash: null,
        publishedAt: null,
      }),
    );
  }

  private defaultName(
    scopeType: ArchitectureScopeType,
    scopeRef: string,
  ): string {
    return scopeType === 'repository'
      ? `Mapa de ${scopeRef.split('/').pop()}`
      : 'Mapa arquitetural';
  }
}
