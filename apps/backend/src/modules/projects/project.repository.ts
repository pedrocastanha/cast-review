import { Inject, Injectable } from '@nestjs/common';
import { DefaultRepository } from 'src/shared/database/postgres/default.database';
import { DataSource } from 'typeorm';
import { Project } from './project.entity';

@Injectable()
export class ProjectRepository extends DefaultRepository<Project> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, Project);
  }
}
