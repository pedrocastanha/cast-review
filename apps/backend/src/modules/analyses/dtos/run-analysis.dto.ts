import { Type } from 'class-transformer';
import { IsString, ValidateNested } from 'class-validator';

class ReviewModelsDto {
  @IsString()
  testReviewer!: string;

  @IsString()
  architectureReviewer!: string;
}

class ApiKeysDto {
  @IsString()
  anthropic!: string;
}

export class RunAnalysisDto {
  @ValidateNested()
  @Type(() => ReviewModelsDto)
  models!: ReviewModelsDto;

  @ValidateNested()
  @Type(() => ApiKeysDto)
  apiKeys!: ApiKeysDto;
}
