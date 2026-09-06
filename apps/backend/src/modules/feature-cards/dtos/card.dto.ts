import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type { CardStatus } from '../domain/card.types';
import { CARD_STATUSES } from '../domain/card.types';

export class SaveProposalDto {
  @IsUUID() messageId: string;
}

export class CardContentDto {
  @IsString() @Length(1, 2000) description: string;
  @IsString() @Length(1, 2000) rationale: string;
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Length(1, 2000, { each: true })
  scope: string[];
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Length(1, 2000, { each: true })
  outOfScope: string[];
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Length(1, 2000, { each: true })
  businessRules: string[];
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Length(1, 2000, { each: true })
  acceptanceCriteria: string[];
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Length(1, 2000, { each: true })
  edgeCases: string[];
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Length(1, 2000, { each: true })
  openQuestions: string[];
}

export class UpdateCardDto {
  @IsInt() @Min(1) version: number;
  @IsOptional() @IsString() @Length(1, 160) title?: string;
  @IsOptional() @IsIn(CARD_STATUSES) status?: CardStatus;
  @IsOptional()
  @ValidateNested()
  @Type(() => CardContentDto)
  content?: CardContentDto;
}

export class BoardQueryDto {
  @IsOptional() @IsUUID() after?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
}
