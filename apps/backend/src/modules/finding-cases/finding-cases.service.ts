import { Injectable } from '@nestjs/common';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { FindingCaseRepository } from './finding-case.repository';
import { FindingCaseEventRepository } from './finding-case-event.repository';
import type { UpdateFindingDispositionDto } from './use-cases/update-finding-disposition/update-finding-disposition.dto';
import { UpdateFindingDispositionUseCase } from './use-cases/update-finding-disposition/update-finding-disposition.use-case';

@Injectable()
export class FindingCasesService {
  private readonly updateDispositionUseCase: UpdateFindingDispositionUseCase;

  constructor(
    caseRepository: FindingCaseRepository,
    eventRepository: FindingCaseEventRepository,
  ) {
    this.updateDispositionUseCase = new UpdateFindingDispositionUseCase(
      caseRepository,
      eventRepository,
    );
  }

  updateDisposition(
    caseId: string,
    currentUser: CurrentUserData,
    dto: UpdateFindingDispositionDto,
  ) {
    return this.updateDispositionUseCase.execute(caseId, currentUser.id, dto);
  }
}
