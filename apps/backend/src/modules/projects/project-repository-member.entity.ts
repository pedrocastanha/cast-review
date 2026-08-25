import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';

@Entity({ name: 'project_repositories' })
@Index('UQ_project_repositories_project_full_name', ['projectId', 'fullName'], {
  unique: true,
})
export class ProjectRepositoryMember extends DefaultEntity<ProjectRepositoryMember> {
  @Column({ name: 'project_id', type: 'uuid' })
  projectId: string;

  @Column({ name: 'github_id', type: 'varchar' })
  githubId: string;

  @Column({ type: 'varchar' })
  owner: string;

  @Column({ type: 'varchar' })
  name: string;

  @Column({ name: 'full_name', type: 'varchar' })
  fullName: string;

  @Column({ type: 'boolean' })
  private: boolean;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ name: 'html_url', type: 'varchar' })
  htmlUrl: string;

  @Column({ name: 'default_branch', type: 'varchar' })
  defaultBranch: string;
}
