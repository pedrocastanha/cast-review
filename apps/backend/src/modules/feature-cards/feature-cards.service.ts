import { Injectable } from '@nestjs/common';
import { AppLogger } from 'src/shared/logger/logger.service';
import { BaseService } from 'src/shared/services/base.service';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { ProjectsService } from '../projects/projects.service';
import type { BoardQueryDto, UpdateCardDto } from './dtos/card.dto';
import { FeatureCardRepository } from './infrastructure/persistence/feature-card.repository';
import { ArchiveFeatureUseCase } from './use-cases/archive-feature/archive-feature.use-case';
import { ListCardHistoryUseCase } from './use-cases/list-card-history/list-card-history.use-case';
import { ListCardsUseCase } from './use-cases/list-cards/list-cards.use-case';
import { SaveProposalUseCase } from './use-cases/save-proposal/save-proposal.use-case';
import { UpdateCardUseCase } from './use-cases/update-card/update-card.use-case';

@Injectable()
export class FeatureCardsService extends BaseService {
  private readonly listCards: ListCardsUseCase;
  private readonly saveProposal: SaveProposalUseCase;
  private readonly updateCard: UpdateCardUseCase;
  private readonly archiveFeature: ArchiveFeatureUseCase;
  private readonly listHistory: ListCardHistoryUseCase;

  constructor(
    repository: FeatureCardRepository,
    projects: ProjectsService,
    logger: AppLogger,
  ) {
    super(logger);
    this.listCards = new ListCardsUseCase(repository, projects);
    this.saveProposal = new SaveProposalUseCase(repository, projects);
    this.updateCard = new UpdateCardUseCase(repository, projects);
    this.archiveFeature = new ArchiveFeatureUseCase(repository, projects);
    this.listHistory = new ListCardHistoryUseCase(repository, projects);
  }

  list(projectId: string, user: CurrentUserData, query: BoardQueryDto) {
    return this.listCards.execute(projectId, user, query);
  }

  save(projectId: string, messageId: string, user: CurrentUserData) {
    return this.saveProposal.execute(projectId, messageId, user);
  }

  update(
    projectId: string,
    id: string,
    dto: UpdateCardDto,
    user: CurrentUserData,
  ) {
    return this.updateCard.execute(projectId, id, dto, user);
  }

  archive(
    projectId: string,
    id: string,
    version: number,
    user: CurrentUserData,
  ) {
    return this.archiveFeature.execute(projectId, id, version, user);
  }

  history(projectId: string, id: string, user: CurrentUserData) {
    return this.listHistory.execute(projectId, id, user);
  }
}
