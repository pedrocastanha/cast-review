import type { ArchitectureCapability } from '../../entities/architecture-capability.entity';
import type { ArchitectureComponent } from '../../entities/architecture-component.entity';
import type { CapabilityCriticality } from '../../domain/architecture-maps.types';

export interface CapabilityView {
  id: string;
  name: string;
  description: string | null;
  criticality: CapabilityCriticality;
  componentCount: number;
  confirmedComponentCount: number;
  repositories: string[];
  symbolCount: number;
  providedEndpoints: number;
  consumedEndpoints: number;
}

export function toCapabilityViews(
  capabilities: ArchitectureCapability[],
  components: ArchitectureComponent[],
): CapabilityView[] {
  return capabilities.map((capability) => {
    const owned = components.filter(
      (component) =>
        component.status === 'assigned' &&
        component.capabilityId === capability.id,
    );
    const sum = (pick: (component: ArchitectureComponent) => number) =>
      owned.reduce((total, component) => total + pick(component), 0);

    return {
      id: capability.id,
      name: capability.name,
      description: capability.description,
      criticality: capability.criticality,
      componentCount: owned.length,
      confirmedComponentCount: owned.filter(
        (component) => component.confidence === 'confirmed',
      ).length,
      repositories: [...new Set(owned.map((component) => component.repoId))].sort(),
      symbolCount: sum((component) => component.metrics?.symbolCount ?? 0),
      providedEndpoints: sum(
        (component) => component.metrics?.providedEndpoints ?? 0,
      ),
      consumedEndpoints: sum(
        (component) => component.metrics?.consumedEndpoints ?? 0,
      ),
    };
  });
}
