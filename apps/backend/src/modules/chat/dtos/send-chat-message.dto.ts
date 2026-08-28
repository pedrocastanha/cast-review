import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';

export class ChatMentionDto {
  @IsString()
  repoId!: string;

  @IsString()
  @Length(1, 400)
  path!: string;
}

export class SendChatMessageDto {
  @IsString()
  @Length(1, 8000)
  content!: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ChatMentionDto)
  mentions?: ChatMentionDto[];

  @IsString()
  model!: string;
}
