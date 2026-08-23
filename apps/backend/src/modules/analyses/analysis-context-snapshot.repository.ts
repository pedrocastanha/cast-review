import { Inject, Injectable } from '@nestjs/common';
import { DefaultRepository } from 'src/shared/database/postgres/default.database';
import { DataSource } from 'typeorm';
import { AnalysisContextSnapshotEntity } from './analysis-context-snapshot.entity';

@Injectable()
export class AnalysisContextSnapshotRepository extends DefaultRepository<AnalysisContextSnapshotEntity> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, AnalysisContextSnapshotEntity);
  }
}
