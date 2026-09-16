import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { dbActorStorage } from '../../shared/database/postgres/db-actor';
import { ServiceTokenGuard } from '../../shared/security/service-token.guard';
import { Public } from '../auth/utils/public.decorator';
import { IntrospectMcpTokenDto } from './dtos/introspect-mcp-token.dto';
import { McpTokensService } from './mcp-tokens.service';

@Controller('internal/mcp-tokens')
@Public()
@UseGuards(ServiceTokenGuard)
export class McpTokensInternalController {
  constructor(private readonly mcpTokensService: McpTokensService) {}

  @Post('introspect')
  introspect(@Body() dto: IntrospectMcpTokenDto) {
    return dbActorStorage.run({ userId: null, actorType: 'service' }, () =>
      this.mcpTokensService.introspect(dto.token),
    );
  }
}
