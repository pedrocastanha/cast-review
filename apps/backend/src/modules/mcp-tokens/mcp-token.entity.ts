import { Column, Entity, Index } from 'typeorm';
import { DefaultEntity } from '../../shared/database/postgres/default.entity';

@Entity({ name: 'mcp_tokens' })
export class McpToken extends DefaultEntity<McpToken> {
  @Index()
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ name: 'token_hash', type: 'varchar', length: 64 })
  tokenHash: string;

  @Column({ name: 'project_ids', type: 'uuid', array: true, default: '{}' })
  projectIds: string[];

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt: Date | null;
}
