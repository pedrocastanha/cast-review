import { IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ValidatePatDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(8)
  token!: string;
}
