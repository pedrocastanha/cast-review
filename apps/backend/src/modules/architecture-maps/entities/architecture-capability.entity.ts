import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';
import type { CapabilityCriticality } from '../domain/architecture-maps.types';

@Entity({ name: 'architecture_capabilities' })
@Index('UQ_architecture_capabilities_map_name', ['mapId', 'name'], {
  unique: true,
})
export class ArchitectureCapability extends DefaultEntity<ArchitectureCapability> {
  @Column({ name: 'map_id', type: 'uuid' })
  mapId: string;

  @Column({ type: 'varchar', length: 80 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'varchar' })
  criticality: CapabilityCriticality;
}
