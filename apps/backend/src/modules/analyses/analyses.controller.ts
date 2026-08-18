import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { CurrentUser } from '../auth/utils/current-user-decorator';
import { AnalysesService } from './analyses.service';
import { ApproveAnalysisDto } from './dtos/approve-analysis.dto';
import { ResumeAnalysisDto } from './dtos/resume-analysis.dto';

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

  @Get('repositories/:repo/analyses')
  listByRepository(
    @Param('repo') repo: string,
    @Query('owner') owner: string | undefined,
    @Query('pullNumber') pullNumber: string | undefined,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.analysesService.listForRepository({
      repo,
      owner,
      pullNumber,
      currentUser,
    });
  }

  @Get('analyses/:id')
  getById(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.analysesService.getByIdForUser(id, currentUser);
  }

  @Post('analyses/:id/resume')
  resume(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserData,
    @Body() dto: ResumeAnalysisDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.analysesService.resume(id, currentUser, dto, req, res);
  }

  @Post('analyses/:id/approve')
  approve(
    @Param('id') id: string,
    @CurrentUser() currentUser: CurrentUserData,
    @Body() dto: ApproveAnalysisDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.analysesService.approve(id, currentUser, dto, req, res);
  }
}
