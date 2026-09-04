import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import type { ArchitectureScopeType } from '../../domain/architecture-maps.types';
import type { ArchitectureMap } from '../../entities/architecture-map.entity';
import type { ArchitectureMapRepository } from '../../infrastructure/persistence/architecture-map.repository';
import type { ArchitectureScopeProvider } from '../shared/architecture-scope.provider';

export class ListArchitectureMapsUseCase {
  constructor(
    private readonly mapRepository: ArchitectureMapRepository,
    private readonly scope: ArchitectureScopeProvider,
  ) {}

  execute(currentUser: CurrentUserData): Promise<ArchitectureMap[]> {
    return this.mapRepository.find({
      where: { ownerId: currentUser.id, active: true },
      order: { updatedAt: 'DESC' },
    });
  }

  forScope(
    scopeType: ArchitectureScopeType,
    scopeRef: string,
    currentUser: CurrentUserData,
  ): Promise<ArchitectureMap | null> {
    return this.mapRepository.findOne({
      where: {
        ownerId: currentUser.id,
        scopeType,
        scopeRef: this.scope.normalizeRef(scopeType, scopeRef),
        active: true,
      },
    });
  }
}
