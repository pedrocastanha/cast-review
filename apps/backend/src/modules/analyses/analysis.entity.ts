import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';
import type {
  AnalysisReview,
  AnalysisStatus,
  Iteration,
  PublishPolicy,
} from './analyses.types';

@Entity({ name: 'analyses' })
@Index('IDX_analyses_user_repo', ['requestedBy', 'owner', 'repo'])
export class Analysis extends DefaultEntity<Analysis> {
  @Index()
  @Column({ name: 'requested_by', type: 'uuid' })
  requestedBy: string;

  @Column({ type: 'varchar' })
  owner: string;

  @Column({ type: 'varchar' })
  repo: string;

  @Column({ name: 'pull_number', type: 'int' })
  pullNumber: number;

  @Column({ type: 'varchar' })
  status: AnalysisStatus;

  @Column({ type: 'jsonb', nullable: true })
  report: AnalysisReview | null;

  @Column({ type: 'jsonb', nullable: true })
  thoughts: Record<string, string> | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'jsonb', nullable: true })
  models: { testReviewer: string; architectureReviewer: string } | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ name: 'approval_stage', type: 'varchar', nullable: true })
  approvalStage: 'prd' | 'spec' | 'publish' | null;

  @Column({ name: 'publish_policy', type: 'jsonb', nullable: true })
  publishPolicy: PublishPolicy | null;

  @Column({ name: 'prd_iterations', type: 'jsonb', default: () => "'[]'" })
  prdIterations: Iteration[];

  @Column({ name: 'spec_iterations', type: 'jsonb', default: () => "'[]'" })
  specIterations: Iteration[];

  @Column({ name: 'resumed_count', type: 'int', default: 0 })
  resumedCount: number;
}
