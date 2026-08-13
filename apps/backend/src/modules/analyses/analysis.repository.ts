import { Inject, Injectable } from '@nestjs/common';
import { DefaultRepository } from 'src/shared/database/postgres/default.database';
import { DataSource } from 'typeorm';
import { Analysis } from './analysis.entity';

@Injectable()
export class AnalysisRepository extends DefaultRepository<Analysis> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, Analysis);
  }
}
