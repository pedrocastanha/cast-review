import { Module } from '@nestjs/common';
import { AiApiClient } from 'src/shared/clients/ai/ai-api.client';
import { ArchitectureMapsModule } from '../architecture-maps/architecture-maps.module';
import { FindingCasesModule } from '../finding-cases/finding-cases.module';
import { ProjectsModule } from '../projects/projects.module';
import { RepositoriesModule } from '../repositories/repositories.module';
import { UsersModule } from '../users/user.module';
import { UserService } from '../users/user.service';
import { AnalysesController } from './analyses.controller';
import { AnalysesService } from './analyses.service';
import { AnalysisRepository } from './analysis.repository';
import { AnalysisContextSnapshotRepository } from './analysis-context-snapshot.repository';

@Module({
  imports: [
    RepositoriesModule,
    ProjectsModule,
    UsersModule,
    FindingCasesModule,
    ArchitectureMapsModule,
  ],
  controllers: [AnalysesController],
  providers: [
    AnalysesService,
    AiApiClient,
    AnalysisRepository,
    AnalysisContextSnapshotRepository,
    { provide: 'USER_SERVICE', useExisting: UserService },
  ],
  exports: [
    AnalysesService,
    AnalysisRepository,
    AnalysisContextSnapshotRepository,
  ],
})
export class AnalysesModule {}
