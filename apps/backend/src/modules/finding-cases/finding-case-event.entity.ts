import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';
import type { FindingCaseEventType } from './finding-cases.types';

@Entity({ name: 'finding_case_events' })
@Index('IDX_finding_case_events_case_created', ['caseId', 'createdAt', 'id'])
export class FindingCaseEvent extends DefaultEntity<FindingCaseEvent> {
  @Column({ name: 'case_id', type: 'uuid' })
  caseId: string;

  @Column({ name: 'analysis_id', type: 'uuid', nullable: true })
  analysisId: string | null;

  @Column({ name: 'actor_id', type: 'uuid', nullable: true })
  actorId: string | null;

  @Column({ type: 'varchar' })
  type: FindingCaseEventType;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  payload: Record<string, unknown>;
}
