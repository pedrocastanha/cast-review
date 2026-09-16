import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { CurrentUser } from '../auth/utils/current-user-decorator';
import { CreateMcpTokenDto } from './dtos/create-mcp-token.dto';
import { McpTokensService } from './mcp-tokens.service';

@Controller()
export class McpTokensController {
  constructor(private readonly mcpTokensService: McpTokensService) {}

  @Post('mcp-tokens')
  issue(
    @Body() dto: CreateMcpTokenDto,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.mcpTokensService.issue(
      currentUser.id,
      dto.projectIds,
      dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    );
  }

  @Get('mcp-tokens')
  async list(@CurrentUser() currentUser: CurrentUserData) {
    const tokens = await this.mcpTokensService.list(currentUser.id);

    return tokens.map((token) => ({
      id: token.id,
      projectIds: token.projectIds,
      createdAt: token.createdAt,
      expiresAt: token.expiresAt,
      revokedAt: token.revokedAt,
    }));
  }

  @Delete('mcp-tokens/:id')
  @HttpCode(204)
  revoke(@Param('id') id: string) {
    return this.mcpTokensService.revoke(id);
  }
}
