import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';

@Entity({ name: 'projects' })
@Index('IDX_projects_owner_active', ['ownerId', 'active'])
export class Project extends DefaultEntity<Project> {
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;
}
