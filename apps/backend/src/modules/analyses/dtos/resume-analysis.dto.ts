import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import { ReviewModelsDto } from './run-analysis.dto';

export class ResumeAnalysisDto {
  @ValidateNested()
  @Type(() => ReviewModelsDto)
  models!: ReviewModelsDto;
}
