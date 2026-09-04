import { createHash } from 'node:crypto';
import type { ArchitectureComponent } from '../entities/architecture-component.entity';
import type { ArchitectureBoundary } from '../entities/architecture-boundary.entity';
import type { ArchitectureScopeRepository } from './architecture-maps.types';

export interface CanonicalMapInput {
  capabilities: Array<{ id: string; name: string; criticality: string }>;
  components: ArchitectureComponent[];
  boundaries: ArchitectureBoundary[];
  repositories: ArchitectureScopeRepository[];
}

export function canonicalMapHash(input: CanonicalMapInput): string {
  const canonical = {
    capabilities: [...input.capabilities]
      .map((capability) => ({
        id: capability.id,
        name: capability.name,
        criticality: capability.criticality,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    components: [...input.components]
      .filter((component) => component.status === 'assigned')
      .map((component) => ({
        candidateKey: component.candidateKey,
        capabilityId: component.capabilityId,
        confidence: component.confidence,
        source: component.source,
      }))
      .sort((left, right) =>
        left.candidateKey.localeCompare(right.candidateKey),
      ),
    boundaries: [...input.boundaries]
      .map((boundary) => ({
        from: boundary.fromCapabilityId,
        to: boundary.toCapabilityId,
        kind: boundary.kind,
      }))
      .sort(
        (left, right) =>
          left.from.localeCompare(right.from) || left.to.localeCompare(right.to),
      ),
    repositories: [...input.repositories]
      .map((repository) => ({ repoId: repository.repoId, sha: repository.sha }))
      .sort((left, right) => left.repoId.localeCompare(right.repoId)),
  };

  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
