import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { BoundaryKind } from '../domain/architecture-maps.types';

export class DeclareBoundaryDto {
  @IsUUID()
  fromCapabilityId!: string;

  @IsUUID()
  toCapabilityId!: string;

  @IsIn(['allow', 'deny', 'review'])
  kind!: BoundaryKind;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  note?: string | null;
}
