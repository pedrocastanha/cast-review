import { detectBoundaryViolations } from '../../domain/boundary.rules';
import { buildCapabilityDependencies } from '../../domain/capability-graph';
import { calculateCoverage } from '../../domain/coverage';
import type {
  ArchitectureCoverage,
  ArchitectureScope,
  BoundaryViolation,
  CapabilityDependency,
} from '../../domain/architecture-maps.types';
import type { ArchitectureBoundary } from '../../entities/architecture-boundary.entity';
import type { ArchitectureComponent } from '../../entities/architecture-component.entity';
import type { ArchitectureMap } from '../../entities/architecture-map.entity';
import type { ArchitectureGraphGateway } from '../../infrastructure/ai/architecture-graph.gateway';
import type { ArchitectureBoundaryRepository } from '../../infrastructure/persistence/architecture-boundary.repository';
import type { ArchitectureCapabilityRepository } from '../../infrastructure/persistence/architecture-capability.repository';
import type { ArchitectureComponentRepository } from '../../infrastructure/persistence/architecture-component.repository';
import {
  type CapabilityView,
  toCapabilityViews,
} from '../shared/capability.presenter';

export interface ArchitectureView {
  map: {
    id: string;
    name: string;
    scopeType: ArchitectureMap['scopeType'];
    scopeRef: string;
    publishedVersion: number | null;
    publishedHash: string | null;
    publishedAt: string | null;
  };
  capabilities: CapabilityView[];
  components: ArchitectureComponent[];
  dependencies: CapabilityDependency[];
  boundaries: ArchitectureBoundary[];
  violations: BoundaryViolation[];
  coverage: ArchitectureCoverage;
  scope: ArchitectureScope;
  dependenciesAvailable: boolean;
}

export class BuildArchitectureViewUseCase {
  constructor(
    private readonly capabilityRepository: ArchitectureCapabilityRepository,
    private readonly componentRepository: ArchitectureComponentRepository,
    private readonly boundaryRepository: ArchitectureBoundaryRepository,
    private readonly graphGateway: ArchitectureGraphGateway,
  ) {}

  async execute(
    map: ArchitectureMap,
    scope: ArchitectureScope,
  ): Promise<ArchitectureView> {
    const [capabilities, components, boundaries] = await Promise.all([
      this.capabilityRepository.find({
        where: { mapId: map.id, active: true },
        order: { name: 'ASC' },
      }),
      this.componentRepository.find({
        where: { mapId: map.id, active: true },
        order: { candidateKey: 'ASC' },
      }),
      this.boundaryRepository.find({ where: { mapId: map.id, active: true } }),
    ]);

    const assigned = components.filter(
      (component) => component.status === 'assigned' && component.capabilityId,
    );
    const resolved = await this.graphGateway.dependencies(scope, assigned);
    const dependencies = buildCapabilityDependencies(
      components,
      resolved.dependencies,
    );

    return {
      map: {
        id: map.id,
        name: map.name,
        scopeType: map.scopeType,
        scopeRef: map.scopeRef,
        publishedVersion: map.publishedVersion,
        publishedHash: map.publishedHash,
        publishedAt: map.publishedAt?.toISOString() ?? null,
      },
      capabilities: toCapabilityViews(capabilities, components),
      components,
      dependencies,
      boundaries,
      violations: detectBoundaryViolations(boundaries, dependencies),
      coverage: calculateCoverage(components),
      scope,
      dependenciesAvailable: resolved.available,
    };
  }
}
