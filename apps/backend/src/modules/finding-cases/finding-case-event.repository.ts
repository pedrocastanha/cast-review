import { Inject, Injectable } from '@nestjs/common';
import { DefaultRepository } from 'src/shared/database/postgres/default.database';
import { DataSource } from 'typeorm';
import { FindingCaseEvent } from './finding-case-event.entity';

@Injectable()
export class FindingCaseEventRepository extends DefaultRepository<FindingCaseEvent> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, FindingCaseEvent);
  }
}
