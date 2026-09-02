import { IsInt, Min } from 'class-validator';

export class TriggerReviewDto {
  @IsInt()
  @Min(1)
  pullNumber!: number;
}
