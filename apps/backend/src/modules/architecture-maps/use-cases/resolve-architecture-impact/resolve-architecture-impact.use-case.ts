import type { ArchitectureChangedFile } from 'src/shared/types';
import { detectBoundaryViolations } from '../../domain/boundary.rules';
import { buildCapabilityDependencies } from '../../domain/capability-graph';
import type {
  ArchitectureImpact,
  ArchitectureImpactCapability,
  ArchitectureImpactReachedCapability,
  ArchitectureScope,
  BoundaryKind,
  CapabilityCriticality,
} from '../../domain/architecture-maps.types';
import type { ArchitectureBoundary } from '../../entities/architecture-boundary.entity';
import type { ArchitectureComponent } from '../../entities/architecture-component.entity';
import type { ArchitectureMap } from '../../entities/architecture-map.entity';
import type { ArchitectureGraphGateway } from '../../infrastructure/ai/architecture-graph.gateway';
import type { ArchitectureMapVersionRepository } from '../../infrastructure/persistence/architecture-map-version.repository';
import type { ArchitectureView } from '../build-architecture-view/build-architecture-view.use-case';

interface FrozenTaxonomy {
  version: number | null;
  hash: string | null;
  usedDraft: boolean;
  capabilities: Array<{
    id: string;
    name: string;
    criticality: CapabilityCriticality;
  }>;
  components: ArchitectureComponent[];
  boundaries: ArchitectureBoundary[];
}

export class ResolveArchitectureImpactUseCase {
  constructor(
    private readonly versionRepository: ArchitectureMapVersionRepository,
    private readonly graphGateway: ArchitectureGraphGateway,
  ) {}

  async execute(
    map: ArchitectureMap,
    scope: ArchitectureScope,
    draft: ArchitectureView,
    changedFiles: ArchitectureChangedFile[],
  ): Promise<ArchitectureImpact | null> {
    const taxonomy = await this.resolveTaxonomy(map, draft);
    const assigned = taxonomy.components.filter(
      (component) => component.status === 'assigned' && component.capabilityId,
    );
    if (assigned.length === 0) return null;

    if (this.graphGateway.usableRepositories(scope).length === 0) return null;

    const impact = await this.graphGateway.impact(
      scope,
      assigned,
      changedFiles,
    );

    const capabilityOf = new Map(
      assigned.map((component) => [component.id, component.capabilityId]),
    );
    const componentById = new Map(
      assigned.map((component) => [component.id, component]),
    );
    const capabilityById = new Map(
      taxonomy.capabilities.map((capability) => [capability.id, capability]),
    );

    const changed = new Map<string, ArchitectureImpactCapability>();
    for (const touched of impact.touched) {
      const capabilityId = capabilityOf.get(touched.componentId);
      const capability = capabilityId
        ? capabilityById.get(capabilityId)
        : undefined;
      if (!capabilityId || !capability) continue;

      let entry = changed.get(capabilityId);
      if (!entry) {
        entry = {
          capabilityId,
          name: capability.name,
          criticality: capability.criticality,
          confidence: 'confirmed',
          components: [],
          files: [],
          symbols: [],
        };
        changed.set(capabilityId, entry);
      }
      const component = componentById.get(touched.componentId);
      if (component) {
        entry.components.push(component.label);
        if (component.confidence === 'inferred') entry.confidence = 'inferred';
      }
      entry.files.push(...touched.changedFiles);
      entry.symbols.push(...touched.changedSymbols);
    }

    const reached = new Map<string, ArchitectureImpactReachedCapability>();
    for (const item of impact.reached) {
      const capabilityId = capabilityOf.get(item.componentId);
      const viaCapabilityId = capabilityOf.get(item.viaComponentId);
      const capability = capabilityId
        ? capabilityById.get(capabilityId)
        : undefined;
      if (
        !capabilityId ||
        !viaCapabilityId ||
        !capability ||
        capabilityId === viaCapabilityId ||
        changed.has(capabilityId)
      ) {
        continue;
      }

      const key = `${capabilityId}|${viaCapabilityId}|${item.direction}`;
      const existing = reached.get(key);
      if (existing) {
        existing.count += item.count;
        for (const kind of item.kinds) {
          if (!existing.kinds.includes(kind)) existing.kinds.push(kind);
        }
        continue;
      }

      const source = componentById.get(item.componentId);
      const via = componentById.get(item.viaComponentId);
      reached.set(key, {
        capabilityId,
        name: capability.name,
        criticality: capability.criticality,
        viaCapabilityId,
        direction: item.direction,
        kinds: [...item.kinds],
        confidence:
          source?.confidence === 'confirmed' && via?.confidence === 'confirmed'
            ? 'confirmed'
            : 'inferred',
        count: item.count,
      });
    }

    const touchedCapabilityIds = new Set([...changed.keys()]);
    const resolved = await this.graphGateway.dependencies(scope, assigned);
    const dependencies = buildCapabilityDependencies(
      taxonomy.components,
      resolved.dependencies,
    );
    const crossed = dependencies.filter(
      (dependency) =>
        touchedCapabilityIds.has(dependency.fromCapabilityId) ||
        touchedCapabilityIds.has(dependency.toCapabilityId),
    );
    const boundariesCrossed = taxonomy.boundaries
      .filter((boundary) =>
        crossed.some(
          (dependency) =>
            dependency.fromCapabilityId === boundary.fromCapabilityId &&
            dependency.toCapabilityId === boundary.toCapabilityId,
        ),
      )
      .map((boundary) => ({
        boundaryId: boundary.id,
        fromCapabilityId: boundary.fromCapabilityId,
        toCapabilityId: boundary.toCapabilityId,
        kind: boundary.kind as BoundaryKind,
      }));

    const violations = detectBoundaryViolations(
      taxonomy.boundaries.filter((boundary) =>
        boundariesCrossed.some((item) => item.boundaryId === boundary.id),
      ),
      crossed,
    );

    const stale = impact.stats.staleRepositories;
    const status =
      stale.length > 0 || impact.stats.unmappedFiles > 0 ? 'degraded' : 'exact';

    return {
      mapId: map.id,
      mapName: map.name,
      version: taxonomy.version,
      hash: taxonomy.hash,
      usedDraft: taxonomy.usedDraft,
      status,
      changed: [...changed.values()],
      reached: [...reached.values()].sort((left, right) => right.count - left.count),
      boundariesCrossed,
      violations,
      unmappedFiles: impact.unmapped.map(
        (file) => `${file.repoId}:${file.path}`,
      ),
      staleRepositories: stale,
      coverage: impact.stats.coverage,
      degradedReason:
        status === 'exact'
          ? null
          : stale.length > 0
            ? 'Um ou mais repositórios do escopo não têm índice utilizável.'
            : 'Parte dos arquivos alterados não está associada a nenhuma capacidade.',
    };
  }

  private async resolveTaxonomy(
    map: ArchitectureMap,
    draft: ArchitectureView,
  ): Promise<FrozenTaxonomy> {
    if (map.publishedVersion === null) {
      return {
        version: null,
        hash: null,
        usedDraft: true,
        capabilities: draft.capabilities,
        components: draft.components,
        boundaries: draft.boundaries,
      };
    }

    const published = await this.versionRepository.findOne({
      where: { mapId: map.id, version: map.publishedVersion },
    });
    if (!published) {
      return {
        version: null,
        hash: null,
        usedDraft: true,
        capabilities: draft.capabilities,
        components: draft.components,
        boundaries: draft.boundaries,
      };
    }

    const snapshot = published.snapshot as {
      capabilities?: FrozenTaxonomy['capabilities'];
      components?: ArchitectureComponent[];
      boundaries?: ArchitectureBoundary[];
    };

    return {
      version: published.version,
      hash: published.hash,
      usedDraft: false,
      capabilities: snapshot.capabilities ?? [],
      components: snapshot.components ?? [],
      boundaries: snapshot.boundaries ?? [],
    };
  }
}
