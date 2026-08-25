import { Module } from '@nestjs/common';
import { AiApiClient } from 'src/shared/clients/ai/ai-api.client';
import { AnalysesModule } from '../analyses/analyses.module';
import { BenchmarkCaseRepository } from './benchmark-case.repository';
import { BenchmarkRunRepository } from './benchmark-run.repository';
import { BenchmarksController } from './benchmarks.controller';
import { BenchmarksService } from './benchmarks.service';

@Module({
  imports: [AnalysesModule],
  controllers: [BenchmarksController],
  providers: [
    BenchmarksService,
    BenchmarkCaseRepository,
    BenchmarkRunRepository,
    AiApiClient,
  ],
})
export class BenchmarksModule {}
