import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';
import type { GithubWebhookDeliveryStatus } from '../domain/github-app.types';

@Entity({ name: 'github_webhook_deliveries' })
export class GithubWebhookDelivery extends DefaultEntity<GithubWebhookDelivery> {
  @Index('UQ_github_webhook_deliveries_delivery_id', { unique: true })
  @Column({ name: 'delivery_id', type: 'varchar' })
  deliveryId: string;

  @Column({ type: 'varchar' })
  event: string;

  @Column({ type: 'varchar', nullable: true })
  action: string | null;

  @Index('IDX_github_webhook_deliveries_installation')
  @Column({ name: 'installation_id', type: 'bigint', nullable: true })
  installationId: string | null;

  @Column({ name: 'repository_full_name', type: 'varchar', nullable: true })
  repositoryFullName: string | null;

  @Column({ name: 'pull_number', type: 'int', nullable: true })
  pullNumber: number | null;

  @Column({ name: 'head_sha', type: 'varchar', nullable: true })
  headSha: string | null;

  @Column({ type: 'varchar' })
  status: GithubWebhookDeliveryStatus;

  @Column({ type: 'text', nullable: true })
  reason: string | null;

  @Column({ name: 'review_run_id', type: 'uuid', nullable: true })
  reviewRunId: string | null;

  @Column({ type: 'jsonb', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({ name: 'received_at', type: 'timestamptz' })
  receivedAt: Date;

  @Column({ name: 'processed_at', type: 'timestamptz', nullable: true })
  processedAt: Date | null;
}
