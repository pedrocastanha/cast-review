import { Inject, Injectable } from '@nestjs/common';
import { DefaultRepository } from 'src/shared/database/postgres/default.database';
import { DataSource } from 'typeorm';
import { GithubReviewRun } from '../../entities/github-review-run.entity';

@Injectable()
export class GithubReviewRunRepository extends DefaultRepository<GithubReviewRun> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, GithubReviewRun);
  }
}
