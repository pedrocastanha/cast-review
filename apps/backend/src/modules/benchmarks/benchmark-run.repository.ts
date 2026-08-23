import { Inject, Injectable } from '@nestjs/common';
import { DefaultRepository } from 'src/shared/database/postgres/default.database';
import { DataSource } from 'typeorm';
import { BenchmarkRun } from './benchmark-run.entity';

@Injectable()
export class BenchmarkRunRepository extends DefaultRepository<BenchmarkRun> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, BenchmarkRun);
  }
}
