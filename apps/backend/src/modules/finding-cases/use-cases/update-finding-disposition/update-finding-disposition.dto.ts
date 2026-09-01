import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { FindingDisposition } from '../../finding-cases.types';

export class UpdateFindingDispositionDto {
  @IsIn(['unreviewed', 'accepted_risk', 'false_positive'])
  disposition!: FindingDisposition;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string | null;
}
