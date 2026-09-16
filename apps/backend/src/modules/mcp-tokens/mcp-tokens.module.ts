import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { McpTokenRepository } from './mcp-token.repository';
import { McpTokensController } from './mcp-tokens.controller';
import { McpTokensService } from './mcp-tokens.service';
import { McpTokensInternalController } from './mcp-tokens-internal.controller';

@Module({
  imports: [JwtModule.register({})],
  controllers: [McpTokensController, McpTokensInternalController],
  providers: [McpTokensService, McpTokenRepository],
  exports: [McpTokensService, McpTokenRepository],
})
export class McpTokensModule {}
