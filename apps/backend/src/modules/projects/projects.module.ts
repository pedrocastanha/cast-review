import { Module } from '@nestjs/common';
import { AiApiClient } from 'src/shared/clients/ai/ai-api.client';
import { RepositoriesModule } from '../repositories/repositories.module';
import { RepositoriesService } from '../repositories/repositories.service';
import { ProjectRepository } from './project.repository';
import { ProjectRepositoryMemberRepository } from './project-repository-member.repository';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  imports: [RepositoriesModule],
  controllers: [ProjectsController],
  providers: [
    ProjectsService,
    ProjectRepository,
    ProjectRepositoryMemberRepository,
    AiApiClient,
    { provide: 'REPOSITORIES_SERVICE', useExisting: RepositoriesService },
  ],
  exports: [ProjectsService],
})
export class ProjectsModule {}
