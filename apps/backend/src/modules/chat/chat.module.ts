import { Module } from '@nestjs/common';
import { AiApiClient } from 'src/shared/clients/ai/ai-api.client';
import { ProjectsModule } from '../projects/projects.module';
import { ProjectsService } from '../projects/projects.service';
import { RepositoriesModule } from '../repositories/repositories.module';
import { RepositoriesService } from '../repositories/repositories.service';
import { UsersModule } from '../users/user.module';
import { UserService } from '../users/user.service';
import { ChatMessageRepository } from './chat-message.repository';
import { ChatThreadRepository } from './chat-thread.repository';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

@Module({
  imports: [RepositoriesModule, ProjectsModule, UsersModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    ChatThreadRepository,
    ChatMessageRepository,
    AiApiClient,
    { provide: 'REPOSITORIES_SERVICE', useExisting: RepositoriesService },
    { provide: 'PROJECTS_SERVICE', useExisting: ProjectsService },
    { provide: 'USER_SERVICE', useExisting: UserService },
  ],
  exports: [ChatService],
})
export class ChatModule {}
