import { Module } from '@nestjs/common';
import { AiApiClient } from 'src/shared/clients/ai/ai-api.client';
import { RepositoriesModule } from '../repositories/repositories.module';
import { AnalysesController } from './analyses.controller';
import { AnalysesService } from './analyses.service';

@Module({
  imports: [RepositoriesModule],
  controllers: [AnalysesController],
  providers: [AnalysesService, AiApiClient],
})
export class AnalysesModule {}
