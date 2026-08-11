import { randomUUID } from 'node:crypto';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { CurrentUser } from '../auth/utils/current-user-decorator';
import { AnalysesService } from './analyses.service';
import { RunAnalysisDto } from './dtos/run-analysis.dto';

@Controller()
export class AnalysesController {
  constructor(private readonly analysesService: AnalysesService) {}

  @Post('repositories/:repo/pulls/:pullNumber/analyses')
  async run(
    @Param('repo') repo: string,
    @Param('pullNumber', ParseIntPipe) pullNumber: number,
    @CurrentUser() currentUser: CurrentUserData,
    @Body() dto: RunAnalysisDto,
    @Query('owner') owner: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const analysisId = randomUUID();
    const abortController = new AbortController();
    req.on('close', () => abortController.abort());

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Analysis-Id': analysisId,
    });

    try {
      for await (const event of this.analysesService.run(
        analysisId,
        repo,
        pullNumber,
        currentUser,
        dto,
        abortController.signal,
        owner,
      )) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    } catch {
      res.write(
        `data: ${JSON.stringify({ type: 'error', payload: { message: 'Falha ao rodar a análise' } })}\n\n`,
      );
    } finally {
      res.end();
    }
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
