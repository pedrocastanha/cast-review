import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DefaultRepository } from '../../shared/database/postgres/default.database';
import { AnalysisContextSnapshotEntity } from './analysis-context-snapshot.entity';

@Injectable()
export class AnalysisContextSnapshotRepository extends DefaultRepository<AnalysisContextSnapshotEntity> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, AnalysisContextSnapshotEntity);
  }
}
