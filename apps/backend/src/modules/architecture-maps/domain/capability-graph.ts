import type {
  ArchitectureComponentDependency,
  ArchitectureDependencyEvidence,
} from 'src/shared/types';
import type { ArchitectureComponent } from '../entities/architecture-component.entity';
import type {
  CapabilityDependency,
  ComponentConfidence,
  DependencyKind,
} from './architecture-maps.types';

const MAX_EVIDENCE_PER_DEPENDENCY = 8;

interface Accumulator {
  fromCapabilityId: string;
  toCapabilityId: string;
  kinds: DependencyKind[];
  count: number;
  confirmedCount: number;
  components: Array<{ fromComponentId: string; toComponentId: string }>;
  evidence: ArchitectureDependencyEvidence[];
  confirmedEvidence: ArchitectureDependencyEvidence[];
}

export function capabilityPairKey(from: string, to: string): string {
  return `${from}->${to}`;
}

function pushEvidence(
  target: ArchitectureDependencyEvidence[],
  evidence: ArchitectureDependencyEvidence[],
): void {
  for (const item of evidence) {
    if (target.length >= MAX_EVIDENCE_PER_DEPENDENCY) return;
    target.push(item);
  }
}

export function buildCapabilityDependencies(
  components: ArchitectureComponent[],
  dependencies: ArchitectureComponentDependency[],
): CapabilityDependency[] {
  const assigned = new Map<string, ArchitectureComponent>();
  for (const component of components) {
    if (component.status === 'assigned' && component.capabilityId) {
      assigned.set(component.id, component);
    }
  }

  const accumulators = new Map<string, Accumulator>();

  for (const dependency of dependencies) {
    const source = assigned.get(dependency.fromComponentId);
    const target = assigned.get(dependency.toComponentId);
    if (!source?.capabilityId || !target?.capabilityId) continue;
    if (source.capabilityId === target.capabilityId) continue;

    const key = capabilityPairKey(source.capabilityId, target.capabilityId);
    let accumulator = accumulators.get(key);
    if (!accumulator) {
      accumulator = {
        fromCapabilityId: source.capabilityId,
        toCapabilityId: target.capabilityId,
        kinds: [],
        count: 0,
        confirmedCount: 0,
        components: [],
        evidence: [],
        confirmedEvidence: [],
      };
      accumulators.set(key, accumulator);
    }

    const confirmed =
      source.confidence === 'confirmed' && target.confidence === 'confirmed';

    accumulator.count += dependency.count;
    if (confirmed) {
      accumulator.confirmedCount += dependency.count;
      pushEvidence(accumulator.confirmedEvidence, dependency.evidence);
    }
    if (!accumulator.kinds.includes(dependency.kind)) {
      accumulator.kinds.push(dependency.kind);
    }
    if (
      !accumulator.components.some(
        (pair) =>
          pair.fromComponentId === source.id && pair.toComponentId === target.id,
      )
    ) {
      accumulator.components.push({
        fromComponentId: source.id,
        toComponentId: target.id,
      });
    }
    pushEvidence(accumulator.evidence, dependency.evidence);
  }

  return [...accumulators.values()]
    .map((accumulator) => ({
      fromCapabilityId: accumulator.fromCapabilityId,
      toCapabilityId: accumulator.toCapabilityId,
      kinds: accumulator.kinds,
      count: accumulator.count,
      confidence: (accumulator.confirmedCount > 0
        ? 'confirmed'
        : 'inferred') as ComponentConfidence,
      components: accumulator.components,
      evidence:
        accumulator.confirmedEvidence.length > 0
          ? accumulator.confirmedEvidence
          : accumulator.evidence,
    }))
    .sort(
      (left, right) =>
        right.count - left.count ||
        left.fromCapabilityId.localeCompare(right.fromCapabilityId) ||
        left.toCapabilityId.localeCompare(right.toCapabilityId),
    );
}
