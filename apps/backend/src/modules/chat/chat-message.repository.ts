import { Inject, Injectable } from '@nestjs/common';
import { DefaultRepository } from 'src/shared/database/postgres/default.database';
import { DataSource } from 'typeorm';
import { ChatMessage } from './chat-message.entity';

@Injectable()
export class ChatMessageRepository extends DefaultRepository<ChatMessage> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, ChatMessage);
  }
}
