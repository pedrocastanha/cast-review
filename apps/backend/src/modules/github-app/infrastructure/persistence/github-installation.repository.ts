import { Inject, Injectable } from '@nestjs/common';
import { DefaultRepository } from 'src/shared/database/postgres/default.database';
import { DataSource } from 'typeorm';
import { GithubInstallation } from '../../entities/github-installation.entity';

@Injectable()
export class GithubInstallationRepository extends DefaultRepository<GithubInstallation> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, GithubInstallation);
  }
}
