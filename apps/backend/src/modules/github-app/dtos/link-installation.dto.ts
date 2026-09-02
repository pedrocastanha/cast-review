import { IsString } from 'class-validator';

export class LinkInstallationDto {
  @IsString()
  installationId!: string;

  @IsString()
  state!: string;
}
