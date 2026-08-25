import { Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

export type ImpactScopeDto =
  | { mode: 'repository' }
  | { mode: 'project'; projectId: string };

export class ProjectImpactScopeDto {
  @IsIn(['project'])
  mode!: 'project';

  @IsUUID()
  projectId!: string;
}

export class ReviewModelsDto {
  @IsString()
  testReviewer!: string;

  @IsString()
  architectureReviewer!: string;
}

export class ApiKeysDto {
  @IsString()
  openai!: string;
}

export class PoliciesDto {
  @IsOptional()
  @IsIn(['manual', 'auto'])
  prd?: 'manual' | 'auto';

  @IsOptional()
  @IsIn(['manual', 'auto'])
  spec?: 'manual' | 'auto';

  @IsOptional()
  @IsIn(['manual', 'auto_safe', 'auto'])
  publish?: 'manual' | 'auto_safe' | 'auto';
}

export class RunAnalysisDto {
  @ValidateNested()
  @Type(() => ReviewModelsDto)
  models!: ReviewModelsDto;

  @ValidateNested()
  @Type(() => ApiKeysDto)
  apiKeys!: ApiKeysDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => PoliciesDto)
  policies?: PoliciesDto;

  impactScope!: ImpactScopeDto;
}
