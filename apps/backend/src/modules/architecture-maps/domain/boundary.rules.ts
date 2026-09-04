import type {
  BoundaryViolation,
  CapabilityDependency,
} from './architecture-maps.types';
import type { ArchitectureBoundary } from '../entities/architecture-boundary.entity';
import { capabilityPairKey } from './capability-graph';

export function detectBoundaryViolations(
  boundaries: ArchitectureBoundary[],
  dependencies: CapabilityDependency[],
): BoundaryViolation[] {
  const byPair = new Map(
    dependencies.map((dependency) => [
      capabilityPairKey(dependency.fromCapabilityId, dependency.toCapabilityId),
      dependency,
    ]),
  );

  const violations: BoundaryViolation[] = [];
  for (const boundary of boundaries) {
    if (boundary.kind === 'allow') continue;
    const dependency = byPair.get(
      capabilityPairKey(boundary.fromCapabilityId, boundary.toCapabilityId),
    );
    if (!dependency) continue;

    violations.push({
      boundaryId: boundary.id,
      fromCapabilityId: boundary.fromCapabilityId,
      toCapabilityId: boundary.toCapabilityId,
      boundaryKind: boundary.kind,
      severity:
        boundary.kind === 'deny' && dependency.confidence === 'confirmed'
          ? 'violation'
          : 'warning',
      confidence: dependency.confidence,
      count: dependency.count,
      evidence: dependency.evidence,
    });
  }

  return violations.sort(
    (left, right) =>
      Number(right.severity === 'violation') -
        Number(left.severity === 'violation') || right.count - left.count,
  );
}
