import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';
import type { ChatScope, ChatScopeMode } from './chat.types';

@Entity({ name: 'chat_threads' })
@Index('IDX_chat_threads_user_updated', ['userId', 'updatedAt'])
export class ChatThread extends DefaultEntity<ChatThread> {
  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'scope_type', type: 'varchar' })
  scopeType: ChatScopeMode;

  @Column({ name: 'repo_id', type: 'varchar', nullable: true })
  repoId: string | null;

  @Column({ name: 'project_id', type: 'uuid', nullable: true })
  projectId: string | null;

  @Column({ type: 'varchar', length: 120 })
  title: string;

  @Column({ type: 'jsonb' })
  scope: ChatScope;
}
