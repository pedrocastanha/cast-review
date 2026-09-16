import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DefaultRepository } from '../../shared/database/postgres/default.database';
import { McpToken } from './mcp-token.entity';

@Injectable()
export class McpTokenRepository extends DefaultRepository<McpToken> {
  constructor(@Inject('DATA_SOURCE') readonly datasource: DataSource) {
    super(datasource, McpToken);
  }
}
