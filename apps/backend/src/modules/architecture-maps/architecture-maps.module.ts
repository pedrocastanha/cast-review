import { Module } from '@nestjs/common';
import { AiApiClient } from 'src/shared/clients/ai/ai-api.client';
import { ProjectsModule } from '../projects/projects.module';
import { ProjectsService } from '../projects/projects.service';
import { RepositoriesModule } from '../repositories/repositories.module';
import { RepositoriesService } from '../repositories/repositories.service';
import { ArchitectureMapsController } from './architecture-maps.controller';
import { ArchitectureMapsService } from './architecture-maps.service';
import { ArchitectureGraphGateway } from './infrastructure/ai/architecture-graph.gateway';
import { ArchitectureBoundaryRepository } from './infrastructure/persistence/architecture-boundary.repository';
import { ArchitectureCapabilityRepository } from './infrastructure/persistence/architecture-capability.repository';
import { ArchitectureComponentRepository } from './infrastructure/persistence/architecture-component.repository';
import { ArchitectureMapRepository } from './infrastructure/persistence/architecture-map.repository';
import { ArchitectureMapVersionRepository } from './infrastructure/persistence/architecture-map-version.repository';

@Module({
  imports: [RepositoriesModule, ProjectsModule],
  controllers: [ArchitectureMapsController],
  providers: [
    ArchitectureMapsService,
    ArchitectureGraphGateway,
    AiApiClient,
    ArchitectureMapRepository,
    ArchitectureMapVersionRepository,
    ArchitectureCapabilityRepository,
    ArchitectureComponentRepository,
    ArchitectureBoundaryRepository,
    { provide: 'REPOSITORIES_SERVICE', useExisting: RepositoriesService },
    { provide: 'PROJECTS_SERVICE', useExisting: ProjectsService },
  ],
  exports: [ArchitectureMapsService],
})
export class ArchitectureMapsModule {}
