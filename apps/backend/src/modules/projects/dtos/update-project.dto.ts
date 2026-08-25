import { ArrayMinSize, ArrayUnique, IsArray, IsOptional, IsString, Length, Matches } from 'class-validator';

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @Length(2, 80)
  @Matches(/\S/, { message: 'name must contain at least one visible character' })
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  description?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  repositories?: string[];
}
