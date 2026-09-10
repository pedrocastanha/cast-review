import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DefaultRepository } from '../../../../shared/database/postgres/default.database';
import { ArchitectureMapVersion } from '../../entities/architecture-map-version.entity';

@Injectable()
export class ArchitectureMapVersionRepository extends DefaultRepository<ArchitectureMapVersion> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, ArchitectureMapVersion);
  }
}
