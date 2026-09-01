import { Body, Controller, Param, Put } from '@nestjs/common';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { CurrentUser } from '../auth/utils/current-user-decorator';
import { FindingCasesService } from './finding-cases.service';
import { UpdateFindingDispositionDto } from './use-cases/update-finding-disposition/update-finding-disposition.dto';

@Controller('finding-cases')
export class FindingCasesController {
  constructor(private readonly findingCasesService: FindingCasesService) {}

  @Put(':caseId/disposition')
  updateDisposition(
    @Param('caseId') caseId: string,
    @CurrentUser() currentUser: CurrentUserData,
    @Body() dto: UpdateFindingDispositionDto,
  ) {
    return this.findingCasesService.updateDisposition(caseId, currentUser, dto);
  }
}
