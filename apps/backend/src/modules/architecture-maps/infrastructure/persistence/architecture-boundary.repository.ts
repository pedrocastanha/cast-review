import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DefaultRepository } from '../../../../shared/database/postgres/default.database';
import { ArchitectureBoundary } from '../../entities/architecture-boundary.entity';

@Injectable()
export class ArchitectureBoundaryRepository extends DefaultRepository<ArchitectureBoundary> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, ArchitectureBoundary);
  }
}
