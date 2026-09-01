import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';
import type { FindingClassification } from './finding-cases.types';

@Entity({ name: 'finding_occurrences' })
@Index('UQ_finding_occurrences_case_analysis', ['caseId', 'analysisId'], {
  unique: true,
})
@Index('IDX_finding_occurrences_analysis_classification', [
  'analysisId',
  'classification',
  'createdAt',
  'id',
])
export class FindingOccurrence extends DefaultEntity<FindingOccurrence> {
  @Column({ name: 'case_id', type: 'uuid' })
  caseId: string;

  @Column({ name: 'analysis_id', type: 'uuid' })
  analysisId: string;

  @Column({ type: 'varchar' })
  classification: FindingClassification;

  @Column({ type: 'varchar' })
  severity: 'fail' | 'warning';

  @Column({ type: 'varchar' })
  reviewer: string;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text' })
  detail: string;

  @Column({ name: 'business_rule', type: 'text', nullable: true })
  businessRule: string | null;

  @Column({ name: 'convention_ref', type: 'text', nullable: true })
  conventionRef: string | null;

  @Column({ name: 'evidence_id', type: 'varchar', nullable: true })
  evidenceId: string | null;

  @Column({ type: 'text', nullable: true })
  path: string | null;

  @Column({ type: 'int', nullable: true })
  line: number | null;

  @Column({ name: 'end_line', type: 'int', nullable: true })
  endLine: number | null;

  @Column({ name: 'source_count', type: 'int', default: 1 })
  sourceCount: number;
}
