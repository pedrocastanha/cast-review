import { Module } from '@nestjs/common';
import { AiApiClient } from 'src/shared/clients/ai/ai-api.client';
import { AnalysesModule } from '../analyses/analyses.module';
import { UsersModule } from '../users/user.module';
import { UserService } from '../users/user.service';
import { BenchmarkCaseRepository } from './benchmark-case.repository';
import { BenchmarkRunRepository } from './benchmark-run.repository';
import { BenchmarksController } from './benchmarks.controller';
import { BenchmarksService } from './benchmarks.service';

@Module({
  imports: [AnalysesModule, UsersModule],
  controllers: [BenchmarksController],
  providers: [
    BenchmarksService,
    BenchmarkCaseRepository,
    BenchmarkRunRepository,
    AiApiClient,
    { provide: 'USER_SERVICE', useExisting: UserService },
  ],
})
export class BenchmarksModule {}
