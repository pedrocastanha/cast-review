import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';
import type {
  FindingCaseState,
  FindingDisposition,
  FindingMatchBasis,
} from './finding-cases.types';

@Entity({ name: 'finding_cases' })
@Index(
  'UQ_finding_cases_scope_fingerprint',
  [
    'requestedBy',
    'owner',
    'repo',
    'pullNumber',
    'fingerprintVersion',
    'fingerprint',
  ],
  { unique: true },
)
@Index('IDX_finding_cases_scope_state', [
  'requestedBy',
  'owner',
  'repo',
  'pullNumber',
  'state',
  'disposition',
])
export class FindingCase extends DefaultEntity<FindingCase> {
  @Column({ name: 'requested_by', type: 'uuid' })
  requestedBy: string;

  @Column({ type: 'varchar' })
  owner: string;

  @Column({ type: 'varchar' })
  repo: string;

  @Column({ name: 'pull_number', type: 'int' })
  pullNumber: number;

  @Column({ type: 'varchar' })
  reviewer: string;

  @Column({ name: 'fingerprint_version', type: 'varchar', length: 16 })
  fingerprintVersion: '1';

  @Column({ type: 'varchar', length: 64 })
  fingerprint: string;

  @Column({ name: 'fingerprint_material', type: 'text' })
  fingerprintMaterial: string;

  @Column({ name: 'match_basis', type: 'varchar' })
  matchBasis: FindingMatchBasis;

  @Column({ type: 'varchar' })
  state: FindingCaseState;

  @Column({ type: 'varchar' })
  disposition: FindingDisposition;

  @Column({ name: 'disposition_note', type: 'text', nullable: true })
  dispositionNote: string | null;

  @Column({ name: 'first_seen_analysis_id', type: 'uuid', nullable: true })
  firstSeenAnalysisId: string | null;

  @Column({ name: 'last_seen_analysis_id', type: 'uuid', nullable: true })
  lastSeenAnalysisId: string | null;

  @Column({ name: 'resolved_in_analysis_id', type: 'uuid', nullable: true })
  resolvedInAnalysisId: string | null;

  @Column({ name: 'reopened_count', type: 'int', default: 0 })
  reopenedCount: number;
}
