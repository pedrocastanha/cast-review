import { Inject, Injectable } from '@nestjs/common';
import { DefaultRepository } from 'src/shared/database/postgres/default.database';
import { DataSource } from 'typeorm';
import { BenchmarkCase } from './benchmark-case.entity';

@Injectable()
export class BenchmarkCaseRepository extends DefaultRepository<BenchmarkCase> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, BenchmarkCase);
  }
}
