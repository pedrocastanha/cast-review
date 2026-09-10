import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DefaultRepository } from '../../shared/database/postgres/default.database';
import { Project } from './project.entity';

@Injectable()
export class ProjectRepository extends DefaultRepository<Project> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, Project);
  }
}
