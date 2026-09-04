import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';

@Entity({ name: 'architecture_map_versions' })
@Index('UQ_architecture_map_versions_map_version', ['mapId', 'version'], {
  unique: true,
})
export class ArchitectureMapVersion extends DefaultEntity<ArchitectureMapVersion> {
  @Column({ name: 'map_id', type: 'uuid' })
  mapId: string;

  @Column({ type: 'int' })
  version: number;

  @Column({ type: 'varchar', length: 64 })
  hash: string;

  @Column({ type: 'jsonb' })
  snapshot: Record<string, unknown>;

  @Column({ name: 'published_by', type: 'uuid', nullable: true })
  publishedBy: string | null;
}
