import { Inject, Injectable } from '@nestjs/common';
import { DefaultRepository } from 'src/shared/database/postgres/default.database';
import { DataSource } from 'typeorm';
import { ChatThread } from './chat-thread.entity';

@Injectable()
export class ChatThreadRepository extends DefaultRepository<ChatThread> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, ChatThread);
  }
}
