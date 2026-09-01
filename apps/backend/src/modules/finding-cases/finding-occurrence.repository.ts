import { Inject, Injectable } from '@nestjs/common';
import { DefaultRepository } from 'src/shared/database/postgres/default.database';
import { DataSource } from 'typeorm';
import { FindingOccurrence } from './finding-occurrence.entity';

@Injectable()
export class FindingOccurrenceRepository extends DefaultRepository<FindingOccurrence> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, FindingOccurrence);
  }
}
