import { randomUUID } from 'node:crypto';
import type { ArchitectureCandidate } from 'src/shared/types';
import type { ArchitectureScope } from '../../domain/architecture-maps.types';
import type { ArchitectureComponent } from '../../entities/architecture-component.entity';
import type { ArchitectureMap } from '../../entities/architecture-map.entity';
import type { ArchitectureGraphGateway } from '../../infrastructure/ai/architecture-graph.gateway';
import type { ArchitectureComponentRepository } from '../../infrastructure/persistence/architecture-component.repository';

export interface SuggestComponentsResult {
  created: number;
  refreshed: number;
  skipped: number;
  omittedRepositories: string[];
  components: ArchitectureComponent[];
}

export class SuggestComponentsUseCase {
  constructor(
    private readonly componentRepository: ArchitectureComponentRepository,
    private readonly graphGateway: ArchitectureGraphGateway,
  ) {}

  async execute(
    map: ArchitectureMap,
    scope: ArchitectureScope,
  ): Promise<SuggestComponentsResult> {
    if (this.graphGateway.usableRepositories(scope).length === 0) {
      return {
        created: 0,
        refreshed: 0,
        skipped: 0,
        omittedRepositories: scope.repositories.map(
          (repository) => repository.repoId,
        ),
        components: await this.listComponents(map.id),
      };
    }

    const result = await this.graphGateway.candidates(scope);
    const byCandidateKey = new Map(
      (await this.listComponents(map.id)).map((component) => [
        component.candidateKey,
        component,
      ]),
    );

    let created = 0;
    let refreshed = 0;
    let skipped = 0;

    for (const candidate of result.candidates) {
      if (candidate.evidence.length === 0) {
        skipped += 1;
        continue;
      }

      const current = byCandidateKey.get(candidate.candidateKey);
      if (current) {
        await this.componentRepository.update(current.id, {
          label: candidate.label,
          kind: candidate.kind,
          indexedSha: candidate.sha,
          metrics: this.toMetrics(candidate),
          evidence: candidate.evidence,
        });
        refreshed += 1;
        continue;
      }

      await this.componentRepository.save(
        this.componentRepository.create({
          id: randomUUID(),
          mapId: map.id,
          capabilityId: null,
          candidateKey: candidate.candidateKey,
          repoId: candidate.repoId,
          pathPrefix: candidate.pathPrefix,
          label: candidate.label,
          kind: candidate.kind,
          source: 'rule',
          confidence: 'inferred',
          status: 'unmapped',
          indexedSha: candidate.sha,
          metrics: this.toMetrics(candidate),
          evidence: candidate.evidence,
        }),
      );
      created += 1;
    }

    return {
      created,
      refreshed,
      skipped,
      omittedRepositories: result.stats.omittedRepositories,
      components: await this.listComponents(map.id),
    };
  }

  private listComponents(mapId: string) {
    return this.componentRepository.find({
      where: { mapId, active: true },
      order: { candidateKey: 'ASC' },
    });
  }

  private toMetrics(candidate: ArchitectureCandidate) {
    return {
      fileCount: candidate.fileCount,
      symbolCount: candidate.symbolCount,
      internalEdges: candidate.internalEdges,
      inboundEdges: candidate.inboundEdges,
      outboundEdges: candidate.outboundEdges,
      providedEndpoints: candidate.providedEndpoints,
      consumedEndpoints: candidate.consumedEndpoints,
    };
  }
}
