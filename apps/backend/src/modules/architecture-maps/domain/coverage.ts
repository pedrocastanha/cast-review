import type { ArchitectureComponent } from '../entities/architecture-component.entity';
import type { ArchitectureCoverage } from './architecture-maps.types';

export function calculateCoverage(
  components: ArchitectureComponent[],
): ArchitectureCoverage {
  const rejected = components.filter(
    (component) => component.status === 'rejected',
  ).length;
  const eligible = components.filter(
    (component) => component.status !== 'rejected',
  );
  const assigned = eligible.filter(
    (component) => component.status === 'assigned' && component.capabilityId,
  );
  const confirmed = assigned.filter(
    (component) => component.confidence === 'confirmed',
  );

  return {
    structural:
      eligible.length === 0
        ? 0
        : Number((assigned.length / eligible.length).toFixed(4)),
    totalComponents: eligible.length,
    assignedComponents: assigned.length,
    unmappedComponents: eligible.length - assigned.length,
    rejectedComponents: rejected,
    confirmedComponents: confirmed.length,
  };
}
