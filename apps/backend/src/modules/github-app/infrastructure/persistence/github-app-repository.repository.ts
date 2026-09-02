import { Inject, Injectable } from '@nestjs/common';
import { DefaultRepository } from 'src/shared/database/postgres/default.database';
import { DataSource } from 'typeorm';
import { GithubAppRepository } from '../../entities/github-app-repository.entity';

@Injectable()
export class GithubAppRepositoryRepository extends DefaultRepository<GithubAppRepository> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, GithubAppRepository);
  }
}
