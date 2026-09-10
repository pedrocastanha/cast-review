import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DefaultRepository } from '../../shared/database/postgres/default.database';
import { Analysis } from './analysis.entity';

@Injectable()
export class AnalysisRepository extends DefaultRepository<Analysis> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, Analysis);
  }
}
