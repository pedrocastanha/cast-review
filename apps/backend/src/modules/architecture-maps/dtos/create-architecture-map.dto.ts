import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import type { ArchitectureScopeType } from '../domain/architecture-maps.types';

export class CreateArchitectureMapDto {
  @IsIn(['repository', 'project'])
  scopeType!: ArchitectureScopeType;

  @IsString()
  @Length(1, 255)
  scopeRef!: string;

  @IsOptional()
  @IsString()
  @Length(1, 80)
  name?: string;
}
