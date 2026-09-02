import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';
import type { GithubInstallationStatus } from '../domain/github-app.types';

@Entity({ name: 'github_installations' })
export class GithubInstallation extends DefaultEntity<GithubInstallation> {
  @Index('UQ_github_installations_installation_id', { unique: true })
  @Column({ name: 'installation_id', type: 'bigint' })
  installationId: string;

  @Column({ name: 'account_login', type: 'varchar' })
  accountLogin: string;

  @Column({ name: 'account_type', type: 'varchar' })
  accountType: string;

  @Column({ name: 'account_id', type: 'bigint', nullable: true })
  accountId: string | null;

  @Index('IDX_github_installations_owner')
  @Column({ name: 'owner_user_id', type: 'uuid', nullable: true })
  ownerUserId: string | null;

  @Column({ type: 'varchar' })
  status: GithubInstallationStatus;

  @Column({ name: 'repository_selection', type: 'varchar', nullable: true })
  repositorySelection: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  permissions: Record<string, string>;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  events: string[];

  @Column({ name: 'paused_at', type: 'timestamptz', nullable: true })
  pausedAt: Date | null;

  @Column({ name: 'suspended_at', type: 'timestamptz', nullable: true })
  suspendedAt: Date | null;

  @Column({ name: 'linked_at', type: 'timestamptz', nullable: true })
  linkedAt: Date | null;

  @Column({ name: 'last_event_at', type: 'timestamptz', nullable: true })
  lastEventAt: Date | null;
}
