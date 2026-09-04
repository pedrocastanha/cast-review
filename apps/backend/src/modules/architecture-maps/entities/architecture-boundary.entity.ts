import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';
import type { BoundaryKind } from '../domain/architecture-maps.types';

@Entity({ name: 'architecture_boundaries' })
@Index(
  'UQ_architecture_boundaries_map_pair',
  ['mapId', 'fromCapabilityId', 'toCapabilityId'],
  { unique: true },
)
export class ArchitectureBoundary extends DefaultEntity<ArchitectureBoundary> {
  @Column({ name: 'map_id', type: 'uuid' })
  mapId: string;

  @Column({ name: 'from_capability_id', type: 'uuid' })
  fromCapabilityId: string;

  @Column({ name: 'to_capability_id', type: 'uuid' })
  toCapabilityId: string;

  @Column({ type: 'varchar' })
  kind: BoundaryKind;

  @Column({ type: 'text', nullable: true })
  note: string | null;
}
