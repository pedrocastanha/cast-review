import { Inject, Injectable } from '@nestjs/common';
import { DefaultRepository } from 'src/shared/database/postgres/default.database';
import type { DeepPartial, EntityManager } from 'typeorm';
import { DataSource } from 'typeorm';
import { ProjectRepositoryMember } from './project-repository-member.entity';

@Injectable()
export class ProjectRepositoryMemberRepository extends DefaultRepository<ProjectRepositoryMember> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, ProjectRepositoryMember);
  }

  async replaceForProject(
    projectId: string,
    members: DeepPartial<ProjectRepositoryMember>[],
    manager: EntityManager,
  ): Promise<void> {
    await this.delete({ projectId }, manager);
    if (members.length > 0) {
      await this.saveMany(members, undefined, manager);
    }
  }
}
