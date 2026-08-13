import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { CurrentUser } from '../auth/utils/current-user-decorator';
import { AnalysesService } from './analyses.service';

@Controller()
export class AnalysesController {
  constructor(private readonly analysesService: AnalysesService) {}

  @Post('repositories/:repo/pulls/:pullNumber/analyses')
  run(
    @Param('repo') repo: string,
    @Param('pullNumber') pullNumber: string,
    @CurrentUser() currentUser: CurrentUserData,
    @Body() body: unknown,
    @Query('owner') owner: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.analysesService.run({
      repo,
      pullNumber,
      currentUser,
      body,
      owner,
      req,
      res,
    });
  }

  @Get('analyses')
  list(@CurrentUser() currentUser: CurrentUserData) {
    return this.analysesService.listForUser(currentUser);
  }

  @Get('analyses/:id')
  getById(@Param('id') id: string, @CurrentUser() currentUser: CurrentUserData) {
    return this.analysesService.getByIdForUser(id, currentUser);
  }
}
