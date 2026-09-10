import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AiApiClient } from '../../shared/clients/ai/ai-api.client';
import { UsersModule } from '../users/user.module';
import { IndexProcessor } from './indexing/index.processor';
import { CODE_INDEX_QUEUE } from './indexing/index-queue.constants';
import { RepositoriesController } from './repositories.controller';
import { RepositoriesService } from './repositories.service';

@Module({
  imports: [UsersModule, BullModule.registerQueue({ name: CODE_INDEX_QUEUE })],
  controllers: [RepositoriesController],
  providers: [RepositoriesService, IndexProcessor, AiApiClient],
  exports: [RepositoriesService],
})
export class RepositoriesModule {}
