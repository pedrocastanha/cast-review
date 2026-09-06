import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import type { ProjectsService } from '../../../projects/projects.service';
import { FeatureCard } from '../../entities/feature-card.entity';
import { FeatureCardRevision } from '../../entities/feature-card-revision.entity';
import type { FeatureCardRepository } from '../../infrastructure/persistence/feature-card.repository';
import { CardOwnershipProvider } from '../shared/card-ownership.provider';
import { cardRevision } from '../shared/card-revision';

export class ArchiveFeatureUseCase {
  private readonly ownership: CardOwnershipProvider;
  constructor(
    private readonly repository: FeatureCardRepository,
    readonly _projects: ProjectsService,
  ) {
    this.ownership = new CardOwnershipProvider();
  }

  async execute(
    projectId: string,
    id: string,
    version: number,
    user: CurrentUserData,
  ) {
    await this.repository.datasource.transaction(async (manager) => {
      await this.ownership.lock(manager, projectId, user);
      const parent = await manager.findOne(FeatureCard, {
        where: { id, projectId, active: true },
      });
      if (!parent) throw new NotFoundException('Feature não encontrada.');
      if (parent.parentId)
        throw new BadRequestException('Arquive a feature principal.');
      if (parent.version !== version)
        throw new ConflictException('A feature mudou. Recarregue.');
      const cards = [
        parent,
        ...(await manager.find(FeatureCard, {
          where: { parentId: id, projectId, active: true },
        })),
      ];
      for (const card of cards) {
        card.active = false;
        card.version += 1;
      }
      await manager.save(FeatureCard, cards);
      await manager.save(
        FeatureCardRevision,
        cards.map((card) => cardRevision(card, user.id)),
      );
    });
  }
}
