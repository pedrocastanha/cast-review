import { Module } from '@nestjs/common';
import { FindingCaseRepository } from './finding-case.repository';
import { FindingCaseEventRepository } from './finding-case-event.repository';
import { FindingCasesController } from './finding-cases.controller';
import { FindingCasesService } from './finding-cases.service';
import { FindingOccurrenceRepository } from './finding-occurrence.repository';

@Module({
  controllers: [FindingCasesController],
  providers: [
    FindingCasesService,
    FindingCaseRepository,
    FindingCaseEventRepository,
    FindingOccurrenceRepository,
  ],
  exports: [
    FindingCaseRepository,
    FindingCaseEventRepository,
    FindingOccurrenceRepository,
  ],
})
export class FindingCasesModule {}
