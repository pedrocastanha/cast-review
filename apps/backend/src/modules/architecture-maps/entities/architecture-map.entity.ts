import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';
import type { ArchitectureScopeType } from '../domain/architecture-maps.types';

@Entity({ name: 'architecture_maps' })
@Index(
  'UQ_architecture_maps_owner_scope',
  ['ownerId', 'scopeType', 'scopeRef'],
  { unique: true },
)
export class ArchitectureMap extends DefaultEntity<ArchitectureMap> {
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId: string;

  @Column({ name: 'scope_type', type: 'varchar' })
  scopeType: ArchitectureScopeType;

  @Column({ name: 'scope_ref', type: 'varchar' })
  scopeRef: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ name: 'published_version', type: 'int', nullable: true })
  publishedVersion: number | null;

  @Column({
    name: 'published_hash',
    type: 'varchar',
    length: 64,
    nullable: true,
  })
  publishedHash: string | null;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt: Date | null;
}
