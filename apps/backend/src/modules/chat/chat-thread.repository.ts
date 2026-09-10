import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DefaultRepository } from '../../shared/database/postgres/default.database';
import { ChatThread } from './chat-thread.entity';

@Injectable()
export class ChatThreadRepository extends DefaultRepository<ChatThread> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, ChatThread);
  }
}
