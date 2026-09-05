import { DefaultEntity } from 'src/shared/database/postgres/default.entity';
import { Column, Entity, Index } from 'typeorm';
import type { FeatureProposal } from '../feature-cards/domain/card.types';
import type {
  ChatCitation,
  ChatMention,
  ChatRole,
  ChatToolCallRecord,
  ChatUsage,
} from './chat.types';

@Entity({ name: 'chat_messages' })
@Index('IDX_chat_messages_thread_created', ['threadId', 'createdAt'])
export class ChatMessage extends DefaultEntity<ChatMessage> {
  @Column({ type: 'jsonb', nullable: true })
  proposal: FeatureProposal | null;
  @Column({ name: 'thread_id', type: 'uuid' })
  threadId: string;

  @Column({ type: 'varchar' })
  role: ChatRole;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'varchar', nullable: true })
  model: string | null;

  @Column({ type: 'jsonb', default: () => "'[]'" })
  mentions: ChatMention[];

  @Column({ name: 'tool_calls', type: 'jsonb', default: () => "'[]'" })
  toolCalls: ChatToolCallRecord[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  citations: ChatCitation[];

  @Column({ type: 'jsonb', nullable: true })
  usage: ChatUsage | null;

  @Column({ type: 'boolean', default: false })
  truncated: boolean;
}
