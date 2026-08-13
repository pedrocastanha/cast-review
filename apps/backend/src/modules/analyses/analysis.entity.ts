import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';
import type { AnalysisReview, AnalysisStatus } from './analyses.types';

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
}
