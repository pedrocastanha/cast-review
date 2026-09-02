import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';

export class RepositoryEventsDto {
  @IsBoolean()
  opened!: boolean;

  @IsBoolean()
  reopened!: boolean;

  @IsBoolean()
  synchronize!: boolean;
}

export class RepositoryModelsDto {
  @IsString()
  testReviewer!: string;

  @IsString()
  architectureReviewer!: string;
}

export class RepositoryImpactScopeDto {
  @IsIn(['repository', 'project'])
  mode!: 'repository' | 'project';

  @IsOptional()
  @IsUUID()
  projectId?: string;
}

export class UpdateRepositoryConfigDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => RepositoryEventsDto)
  events?: RepositoryEventsDto;

  @IsOptional()
  @IsBoolean()
  includeDrafts?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  baseBranches?: string[];

  @IsOptional()
  @ValidateNested()
  @Type(() => RepositoryModelsDto)
  models?: RepositoryModelsDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => RepositoryImpactScopeDto)
  impactScope?: RepositoryImpactScopeDto;

  @IsOptional()
  @IsIn(['check_only', 'comments'])
  publishPolicy?: 'check_only' | 'comments';

  @IsOptional()
  @IsNumber()
  @Min(0)
  budgetMonthlyUsd?: number | null;

  @IsOptional()
  @IsNumber()
  @Min(0)
  budgetPerRunUsd?: number | null;

  @IsOptional()
  @IsIn(['proceed', 'skip'])
  staleIndexBehavior?: 'proceed' | 'skip';

  @IsOptional()
  @IsBoolean()
  paused?: boolean;
}
