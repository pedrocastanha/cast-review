import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';

@Entity('feature_card_revisions')
@Index('IDX_feature_card_revisions_card', ['cardId', 'version'], {
  unique: true,
})
export class FeatureCardRevision extends DefaultEntity<FeatureCardRevision> {
  constructor(data: Partial<FeatureCardRevision> = {}) {
    super(data);
    Object.assign(this, data);
  }
  @Column({ name: 'card_id', type: 'uuid' }) cardId: string;
  @Column({ name: 'actor_id', type: 'uuid' }) actorId: string;
  @Column({ type: 'integer' }) version: number;
  @Column({ type: 'jsonb' }) snapshot: Record<string, unknown>;
}
