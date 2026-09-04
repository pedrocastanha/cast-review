import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import type { CapabilityCriticality } from '../domain/architecture-maps.types';

export class UpsertCapabilityDto {
  @IsString()
  @Length(1, 80)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  description?: string | null;

  @IsIn(['low', 'medium', 'high', 'critical'])
  criticality!: CapabilityCriticality;
}
