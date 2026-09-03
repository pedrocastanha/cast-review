import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';
import type {
  GithubAppRepositoryConfig,
  RepositoryConfigStatus,
} from '../domain/github-app.types';

@Entity({ name: 'github_app_repositories' })
@Index(
  'UQ_github_app_repositories_installation_repo',
  ['installationId', 'githubRepoId'],
  {
    unique: true,
  },
)
export class GithubAppRepository extends DefaultEntity<GithubAppRepository> {
  @Index('IDX_github_app_repositories_installation')
  @Column({ name: 'installation_id', type: 'uuid' })
  installationId: string;

  @Column({ name: 'github_repo_id', type: 'bigint' })
  githubRepoId: string;

  @Column({ type: 'varchar' })
  owner: string;

  @Column({ type: 'varchar' })
  repo: string;

  @Column({ name: 'full_name', type: 'varchar' })
  fullName: string;

  @Column({ name: 'is_private', type: 'boolean', default: false })
  isPrivate: boolean;

  @Column({ name: 'default_branch', type: 'varchar', nullable: true })
  defaultBranch: string | null;

  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  @Column({ type: 'jsonb' })
  config: GithubAppRepositoryConfig;

  @Column({
    name: 'config_status',
    type: 'varchar',
    default: 'configuration_required',
  })
  configStatus: RepositoryConfigStatus;

  @Column({ name: 'config_reason', type: 'text', nullable: true })
  configReason: string | null;

  @Column({ name: 'paused_at', type: 'timestamptz', nullable: true })
  pausedAt: Date | null;

  @Column({ name: 'removed_at', type: 'timestamptz', nullable: true })
  removedAt: Date | null;
}
