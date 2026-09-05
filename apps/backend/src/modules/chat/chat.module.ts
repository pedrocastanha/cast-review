import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { AiApiClient } from 'src/shared/clients/ai/ai-api.client';
import { RepositoriesModule } from '../repositories/repositories.module';
import { RepositoriesService } from '../repositories/repositories.service';
import { UsersModule } from '../users/user.module';
import { UserService } from '../users/user.service';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ChatCatalogController } from './chat-catalog.controller';
import { ChatCatalogGrantService } from './chat-catalog-grant.service';
import { ChatMessageRepository } from './chat-message.repository';
import { ChatThreadRepository } from './chat-thread.repository';

@Module({
  imports: [RepositoriesModule, UsersModule, ProjectsModule],
  controllers: [ChatController, ChatCatalogController],
  providers: [
    ChatService,
    ChatThreadRepository,
    ChatMessageRepository,
    ChatCatalogGrantService,
    AiApiClient,
    { provide: 'REPOSITORIES_SERVICE', useExisting: RepositoriesService },
    { provide: 'USER_SERVICE', useExisting: UserService },
  ],
  exports: [ChatService],
})
export class ChatModule {}
