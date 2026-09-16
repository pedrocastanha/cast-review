import { IsNotEmpty, IsString } from 'class-validator';

export class IntrospectMcpTokenDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}
