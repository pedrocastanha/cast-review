import { IsIn, IsOptional, IsUUID } from 'class-validator';
import type { ComponentStatus } from '../domain/architecture-maps.types';

export class AssignComponentDto {
  @IsIn(['unmapped', 'assigned', 'rejected'])
  status!: ComponentStatus;

  @IsOptional()
  @IsUUID()
  capabilityId?: string | null;
}
