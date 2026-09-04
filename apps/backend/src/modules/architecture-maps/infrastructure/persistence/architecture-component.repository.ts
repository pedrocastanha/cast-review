import { Inject, Injectable } from '@nestjs/common';
import { DefaultRepository } from 'src/shared/database/postgres/default.database';
import { DataSource } from 'typeorm';
import { ArchitectureComponent } from '../../entities/architecture-component.entity';

@Injectable()
export class ArchitectureComponentRepository extends DefaultRepository<ArchitectureComponent> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, ArchitectureComponent);
  }
}
