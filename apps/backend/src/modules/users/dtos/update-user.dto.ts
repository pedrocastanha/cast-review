import { IsEmail, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class UpdateUserDto{
  @IsString()
  @IsOptional()
  name: string

  @IsString()
  @IsOptional()
  username: string

  @IsEmail()
  @IsOptional()
  email: string

  @IsString()
  @IsOptional()
  githubToken: string
}
