import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';
import type {
  CardContent,
  CardSnapshot,
  CardStatus,
} from '../domain/card.types';

@Entity('feature_cards')
@Index('IDX_feature_cards_board', ['projectId', 'active', 'id'])
export class FeatureCard extends DefaultEntity<FeatureCard> {
  constructor(data: Partial<FeatureCard> = {}) {
    super(data);
    Object.assign(this, data);
  }
  @Column({ name: 'project_id', type: 'uuid' }) projectId: string;
  @Column({ name: 'parent_id', type: 'uuid', nullable: true }) parentId:
    | string
    | null;
  @Column({ name: 'source_message_id', type: 'uuid' }) sourceMessageId: string;
  @Column({ name: 'task_key', type: 'varchar', length: 40 }) taskKey: string;
  @Column({ type: 'varchar', length: 160 }) title: string;
  @Column({ type: 'varchar', length: 80 }) area: string;
  @Column({ type: 'varchar', default: 'draft' }) status: CardStatus;
  @Column({ type: 'integer', default: 1 }) version: number;
  @Column({ type: 'jsonb' }) content: CardContent;
  @Column({ type: 'jsonb' }) snapshot: CardSnapshot;
  @Column({ name: 'depends_on', type: 'jsonb', default: () => "'[]'" })
  dependsOn: string[];
}
