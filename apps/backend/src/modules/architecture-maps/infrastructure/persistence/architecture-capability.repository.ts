import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DefaultRepository } from '../../../../shared/database/postgres/default.database';
import { ArchitectureCapability } from '../../entities/architecture-capability.entity';

@Injectable()
export class ArchitectureCapabilityRepository extends DefaultRepository<ArchitectureCapability> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, ArchitectureCapability);
  }
}
