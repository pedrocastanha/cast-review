import {
  ArrayNotEmpty,
  IsArray,
  IsISO8601,
  IsOptional,
  IsUUID,
} from 'class-validator';

export class CreateMcpTokenDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsUUID('4', { each: true })
  projectIds!: string[];

  @IsOptional()
  @IsISO8601()
  expiresAt?: string;
}
