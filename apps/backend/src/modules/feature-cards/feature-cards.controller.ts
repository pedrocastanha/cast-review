import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { CurrentUser } from '../auth/utils/current-user-decorator';
import { BoardQueryDto, SaveProposalDto, UpdateCardDto } from './dtos/card.dto';
import { FeatureCardsService } from './feature-cards.service';

@Controller('projects/:projectId/cards')
export class FeatureCardsController {
  constructor(private readonly cards: FeatureCardsService) {}

  @Get()
  list(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query() query: BoardQueryDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.cards.list(projectId, user, query);
  }

  @Post('from-message')
  save(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: SaveProposalDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.cards.save(projectId, body.messageId, user);
  }

  @Patch(':id')
  update(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCardDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.cards.update(projectId, id, body, user);
  }

  @Post(':id/archive')
  @HttpCode(204)
  archive(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateCardDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.cards.archive(projectId, id, body.version, user);
  }

  @Get(':id/history')
  history(
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.cards.history(projectId, id, user);
  }
}
