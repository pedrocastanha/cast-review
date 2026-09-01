import { Inject, Injectable } from '@nestjs/common';
import { DefaultRepository } from 'src/shared/database/postgres/default.database';
import { DataSource } from 'typeorm';
import { FindingCase } from './finding-case.entity';

@Injectable()
export class FindingCaseRepository extends DefaultRepository<FindingCase> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, FindingCase);
  }
}
