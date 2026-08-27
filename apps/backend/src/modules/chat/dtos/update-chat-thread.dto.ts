import { IsString, Length } from 'class-validator';

export class UpdateChatThreadDto {
  @IsString()
  @Length(1, 120)
  title!: string;
}
