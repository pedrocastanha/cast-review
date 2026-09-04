import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';
import type {
  ComponentConfidence,
  ComponentEvidence,
  ComponentMetrics,
  ComponentSource,
  ComponentStatus,
} from '../domain/architecture-maps.types';

@Entity({ name: 'architecture_components' })
@Index(
  'UQ_architecture_components_map_candidate',
  ['mapId', 'candidateKey'],
  { unique: true },
)
@Index('IDX_architecture_components_map_capability', ['mapId', 'capabilityId'])
export class ArchitectureComponent extends DefaultEntity<ArchitectureComponent> {
  @Column({ name: 'map_id', type: 'uuid' })
  mapId: string;

  @Column({ name: 'capability_id', type: 'uuid', nullable: true })
  capabilityId: string | null;

  @Column({ name: 'candidate_key', type: 'varchar' })
  candidateKey: string;

  @Column({ name: 'repo_id', type: 'varchar' })
  repoId: string;

  @Column({ name: 'path_prefix', type: 'varchar' })
  pathPrefix: string;

  @Column({ type: 'varchar' })
  label: string;

  @Column({ type: 'varchar' })
  kind: string;

  @Column({ type: 'varchar' })
  source: ComponentSource;

  @Column({ type: 'varchar' })
  confidence: ComponentConfidence;

  @Column({ type: 'varchar' })
  status: ComponentStatus;

  @Column({ name: 'indexed_sha', type: 'varchar', nullable: true })
  indexedSha: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  metrics: ComponentMetrics;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  evidence: ComponentEvidence[];
}
