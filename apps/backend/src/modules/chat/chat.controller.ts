import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { CurrentUser } from '../auth/utils/current-user-decorator';
import { ChatService } from './chat.service';
import { CreateChatThreadDto } from './dtos/create-chat-thread.dto';
import { SendChatMessageDto } from './dtos/send-chat-message.dto';
import { UpdateChatThreadDto } from './dtos/update-chat-thread.dto';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('threads')
  create(
    @Body() body: CreateChatThreadDto,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.chatService.create(body, currentUser);
  }

  @Get('threads')
  list(
    @CurrentUser() currentUser: CurrentUserData,
    @Query('repoId') repoId?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.chatService.list(currentUser, { repoId, projectId });
  }

  @Get('threads/:id')
  get(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserData) {
    return this.chatService.get(id, currentUser);
  }

  @Patch('threads/:id')
  rename(
    @Param('id') id: string,
    @Body() body: UpdateChatThreadDto,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.chatService.rename(id, body.title, currentUser);
  }

  @Delete('threads/:id')
  @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserData) {
    return this.chatService.remove(id, currentUser);
  }

  @Get('threads/:id/files')
  listFiles(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserData,
    @Query('query') query?: string,
    @Query('limit') limit?: string,
  ) {
    const parsed = Number.parseInt(limit ?? '', 10);
    return this.chatService.listFiles(
      id,
      currentUser,
      query,
      Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 50,
    );
  }

  @Post('threads/:id/messages')
  sendMessage(
    @Param('id') id: string,
    @Body() body: SendChatMessageDto,
    @CurrentUser() currentUser: CurrentUserData,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.chatService.sendMessage(id, body, currentUser, req, res);
  }
}
