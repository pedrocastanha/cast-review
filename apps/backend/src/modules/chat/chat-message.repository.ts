import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DefaultRepository } from '../../shared/database/postgres/default.database';
import { ChatMessage } from './chat-message.entity';

@Injectable()
export class ChatMessageRepository extends DefaultRepository<ChatMessage> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, ChatMessage);
  }
}
