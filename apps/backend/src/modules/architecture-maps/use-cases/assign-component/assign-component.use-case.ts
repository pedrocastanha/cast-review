import { BadRequestException } from '@nestjs/common';
import type { AssignComponentDto } from '../../dtos/assign-component.dto';
import type { ArchitectureComponent } from '../../entities/architecture-component.entity';
import type { ArchitectureMap } from '../../entities/architecture-map.entity';
import type { ArchitectureComponentRepository } from '../../infrastructure/persistence/architecture-component.repository';
import type { ArchitectureMapOwnershipProvider } from '../shared/architecture-map-ownership.provider';

export class AssignComponentUseCase {
  constructor(
    private readonly ownership: ArchitectureMapOwnershipProvider,
    private readonly componentRepository: ArchitectureComponentRepository,
  ) {}

  async execute(
    map: ArchitectureMap,
    componentId: string,
    input: AssignComponentDto,
  ): Promise<ArchitectureComponent> {
    const component = await this.ownership.component(map, componentId);

    if (input.status === 'assigned') {
      if (!input.capabilityId) {
        throw new BadRequestException(
          'capabilityId é obrigatório para confirmar um componente.',
        );
      }
      await this.ownership.capability(map, input.capabilityId);

      const patch = {
        capabilityId: input.capabilityId,
        status: 'assigned' as const,
        confidence: 'confirmed' as const,
        source: component.source === 'rule' ? ('manual' as const) : component.source,
      };
      await this.componentRepository.update(component.id, patch);
      return Object.assign(component, patch);
    }

    const patch = {
      capabilityId: null,
      status: input.status,
      confidence: 'inferred' as const,
    };
    await this.componentRepository.update(component.id, patch);
    return Object.assign(component, patch);
  }
}
