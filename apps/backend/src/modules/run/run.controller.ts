import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { RunService } from './run.service';

@Controller('runs')
export class RunController {
  constructor(private readonly runService: RunService) {}

  @Get()
  list() {
    return { runIds: this.runService.listReportIds() };
  }

  @Get(':runId')
  getOne(@Param('runId') runId: string) {
    const report = this.runService.getReport(runId);
    if (!report) {
      throw new NotFoundException(`Report not found for runId=${runId}`);
    }
    return report;
  }
}
