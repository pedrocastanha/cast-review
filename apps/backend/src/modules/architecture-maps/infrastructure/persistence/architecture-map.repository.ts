import { Inject, Injectable } from '@nestjs/common';
import { DefaultRepository } from 'src/shared/database/postgres/default.database';
import { DataSource } from 'typeorm';
import { ArchitectureMap } from '../../entities/architecture-map.entity';

@Injectable()
export class ArchitectureMapRepository extends DefaultRepository<ArchitectureMap> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, ArchitectureMap);
  }
}
