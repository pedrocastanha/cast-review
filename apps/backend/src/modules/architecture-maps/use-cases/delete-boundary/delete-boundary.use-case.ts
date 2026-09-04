import type { ArchitectureMap } from '../../entities/architecture-map.entity';
import type { ArchitectureBoundaryRepository } from '../../infrastructure/persistence/architecture-boundary.repository';
import type { ArchitectureMapOwnershipProvider } from '../shared/architecture-map-ownership.provider';

export class DeleteBoundaryUseCase {
  constructor(
    private readonly ownership: ArchitectureMapOwnershipProvider,
    private readonly boundaryRepository: ArchitectureBoundaryRepository,
  ) {}

  async execute(map: ArchitectureMap, boundaryId: string) {
    const boundary = await this.ownership.boundary(map, boundaryId);
    await this.boundaryRepository.delete({ id: boundary.id });
    return { id: boundary.id };
  }
}
