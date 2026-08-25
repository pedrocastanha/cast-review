import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';
import type { AnalysisContextSnapshot } from './analyses.types';

@Entity({ name: 'analysis_context_snapshots' })
export class AnalysisContextSnapshotEntity extends DefaultEntity<AnalysisContextSnapshotEntity> {
  @Index({ unique: true })
  @Column({ name: 'analysis_id', type: 'uuid', unique: true })
  analysisId: string;

  @Column({ name: 'schema_version', type: 'varchar' })
  schemaVersion: string;

  @Index()
  @Column({ name: 'snapshot_hash', type: 'varchar' })
  snapshotHash: string;

  @Column({ name: 'graph_snapshot', type: 'jsonb' })
  graphSnapshot: AnalysisContextSnapshot;
}
