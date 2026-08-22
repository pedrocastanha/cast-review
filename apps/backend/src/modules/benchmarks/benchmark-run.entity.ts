import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';
import type { AnalysisReview } from '../analyses/analyses.types';

export type BenchmarkRunStatus = 'running' | 'completed' | 'error';

export interface BenchmarkModelResult {
  model: string;
  status: 'completed' | 'error';
  durationMs: number;
  report: AnalysisReview | null;
  errorMessage: string | null;
}

@Entity({ name: 'benchmark_runs' })
@Index('IDX_benchmark_runs_case_created', ['caseId', 'createdAt'])
export class BenchmarkRun extends DefaultEntity<BenchmarkRun> {
  @Column({ name: 'case_id', type: 'uuid' })
  caseId: string;

  @Column({ name: 'requested_by', type: 'uuid' })
  requestedBy: string;

  @Column({ type: 'varchar' })
  status: BenchmarkRunStatus;

  @Column({ type: 'jsonb' })
  models: string[];

  @Column({ name: 'prompt_version', type: 'varchar' })
  promptVersion: string;

  @Column({ name: 'graph_snapshot_hash', type: 'varchar' })
  graphSnapshotHash: string;

  @Column({ type: 'jsonb', nullable: true })
  results: BenchmarkModelResult[] | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
