import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';
import type {
  CheckRunSnapshot,
  GithubReviewRunStatus,
  GithubReviewRunTrigger,
  GithubReviewSkipReason,
} from '../domain/github-app.types';

@Entity({ name: 'github_review_runs' })
@Index(
  'UQ_github_review_runs_logical',
  ['repositoryId', 'pullNumber', 'headSha', 'configHash'],
  { unique: true },
)
@Index('IDX_github_review_runs_repo_pull', [
  'repositoryId',
  'pullNumber',
  'status',
])
export class GithubReviewRun extends DefaultEntity<GithubReviewRun> {
  @Index('IDX_github_review_runs_installation')
  @Column({ name: 'installation_id', type: 'uuid' })
  installationId: string;

  @Column({ name: 'repository_id', type: 'uuid' })
  repositoryId: string;

  @Column({ name: 'github_installation_id', type: 'bigint' })
  githubInstallationId: string;

  @Column({ type: 'varchar' })
  owner: string;

  @Column({ type: 'varchar' })
  repo: string;

  @Column({ name: 'pull_number', type: 'int' })
  pullNumber: number;

  @Column({ name: 'head_sha', type: 'varchar' })
  headSha: string;

  @Column({ name: 'base_ref', type: 'varchar', nullable: true })
  baseRef: string | null;

  @Column({ name: 'config_hash', type: 'varchar', length: 64 })
  configHash: string;

  @Column({ name: 'delivery_id', type: 'varchar', nullable: true })
  deliveryId: string | null;

  @Column({ type: 'varchar' })
  trigger: GithubReviewRunTrigger;

  @Column({ name: 'event_action', type: 'varchar', nullable: true })
  eventAction: string | null;

  @Column({ type: 'varchar' })
  status: GithubReviewRunStatus;

  @Column({ name: 'skip_reason', type: 'varchar', nullable: true })
  skipReason: GithubReviewSkipReason | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Index('IDX_github_review_runs_analysis')
  @Column({ name: 'analysis_id', type: 'uuid', nullable: true })
  analysisId: string | null;

  @Column({ name: 'check_run', type: 'jsonb', nullable: true })
  checkRun: CheckRunSnapshot | null;

  @Column({ name: 'budget_month', type: 'varchar', length: 7 })
  budgetMonth: string;

  @Column({
    name: 'reserved_usd',
    type: 'numeric',
    precision: 12,
    scale: 6,
    default: 0,
    transformer: {
      to: (value: number) => value,
      from: (value: string | number | null) =>
        value === null ? 0 : Number(value),
    },
  })
  reservedUsd: number;

  @Column({
    name: 'consumed_usd',
    type: 'numeric',
    precision: 12,
    scale: 6,
    nullable: true,
    transformer: {
      to: (value: number | null) => value,
      from: (value: string | number | null) =>
        value === null ? null : Number(value),
    },
  })
  consumedUsd: number | null;

  @Column({ name: 'attempts', type: 'int', default: 0 })
  attempts: number;

  @Column({ name: 'queued_at', type: 'timestamptz' })
  queuedAt: Date;

  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ name: 'finished_at', type: 'timestamptz', nullable: true })
  finishedAt: Date | null;
}
