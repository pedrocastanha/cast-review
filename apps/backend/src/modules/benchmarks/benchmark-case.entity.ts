import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';
import type { AnalysisContextSnapshot } from '../analyses/analyses.types';

export type BenchmarkCaseKind = 'curated' | 'private';
export type BenchmarkEvaluationMode = 'exploratory' | 'scored';

@Entity({ name: 'benchmark_cases' })
@Index('IDX_benchmark_cases_owner_kind', ['ownerId', 'kind'])
export class BenchmarkCase extends DefaultEntity<BenchmarkCase> {
  @Column({ type: 'varchar', nullable: true })
  slug: string | null;

  @Column({ type: 'varchar' })
  title: string;

  @Column({ type: 'varchar' })
  kind: BenchmarkCaseKind;

  @Column({ name: 'evaluation_mode', type: 'varchar' })
  evaluationMode: BenchmarkEvaluationMode;

  @Column({ name: 'owner_id', type: 'uuid', nullable: true })
  ownerId: string | null;

  @Column({ type: 'jsonb' })
  source: Record<string, unknown>;

  @Column({ name: 'input_snapshot', type: 'jsonb' })
  inputSnapshot: AnalysisContextSnapshot['input'];

  @Column({ name: 'graph_snapshot', type: 'jsonb' })
  graphSnapshot: AnalysisContextSnapshot;

  @Column({ name: 'ground_truth', type: 'jsonb', nullable: true })
  groundTruth: Record<string, unknown> | null;

  @Column({ type: 'int', default: 1 })
  version: number;
}
