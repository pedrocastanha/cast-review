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
import { BenchmarksService } from './benchmarks.service';

@Controller('benchmarks')
export class BenchmarksController {
  constructor(private readonly benchmarksService: BenchmarksService) {}

  @Get('cases')
  listCases(@CurrentUser() currentUser: CurrentUserData) {
    return this.benchmarksService.listCases(currentUser);
  }

  @Post('cases/from-analysis/:analysisId')
  createFromAnalysis(
    @Param('analysisId') analysisId: string,
    @CurrentUser() currentUser: CurrentUserData,
    @Body() body: { title?: string },
  ) {
    return this.benchmarksService.createFromAnalysis(
      analysisId,
      currentUser,
      body ?? {},
    );
  }

  @Get('cases/:caseId')
  getCase(
    @Param('caseId') caseId: string,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.benchmarksService.getCase(caseId, currentUser);
  }

  @Delete('cases/:caseId')
  @HttpCode(204)
  deleteCase(
    @Param('caseId') caseId: string,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.benchmarksService.deleteCase(caseId, currentUser);
  }

  @Get('cases/:caseId/runs')
  listRuns(
    @Param('caseId') caseId: string,
    @CurrentUser() currentUser: CurrentUserData,
  ) {
    return this.benchmarksService.listRuns(caseId, currentUser);
  }

  @Post('cases/:caseId/runs')
  runCase(
    @Param('caseId') caseId: string,
    @CurrentUser() currentUser: CurrentUserData,
    @Body() body: { models: string[] },
  ) {
    return this.benchmarksService.runCase(caseId, currentUser, body);
  }
}
