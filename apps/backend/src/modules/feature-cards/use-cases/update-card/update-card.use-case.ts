import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { In } from 'typeorm';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import type { ProjectsService } from '../../../projects/projects.service';
import { assertTransition } from '../../domain/card.rules';
import type { UpdateCardDto } from '../../dtos/card.dto';
import { FeatureCard } from '../../entities/feature-card.entity';
import { FeatureCardRevision } from '../../entities/feature-card-revision.entity';
import type { FeatureCardRepository } from '../../infrastructure/persistence/feature-card.repository';
import { CardOwnershipProvider } from '../shared/card-ownership.provider';
import { cardRevision } from '../shared/card-revision';

export class UpdateCardUseCase {
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
    dto: UpdateCardDto,
    user: CurrentUserData,
  ) {
    return this.repository.datasource.transaction(async (manager) => {
      await this.ownership.lock(manager, projectId, user);
      const card = await manager.findOne(FeatureCard, {
        where: { id, projectId, active: true },
      });
      if (!card) throw new NotFoundException('Card não encontrado.');
      if (card.version !== dto.version)
        throw new ConflictException(
          'O card mudou. Recarregue antes de salvar.',
        );
      const content = dto.content ?? card.content;
      const status = dto.status ?? card.status;
      const dependencies = card.dependsOn.length
        ? await manager.find(FeatureCard, {
            where: { id: In(card.dependsOn), projectId, active: true },
          })
        : [];
      if (dependencies.length !== card.dependsOn.length)
        throw new BadRequestException('Dependência indisponível.');
      const children = await manager.find(FeatureCard, {
        where: { parentId: card.id, projectId, active: true },
      });
      assertTransition(
        status,
        content.openQuestions,
        dependencies.map((c) => c.status),
        children.map((c) => c.status),
      );
      if (card.parentId && status !== 'draft') {
        const parent = await manager.findOne(FeatureCard, {
          where: { id: card.parentId, projectId, active: true },
        });
        if (parent?.content.openQuestions.length)
          throw new BadRequestException(
            'Resolva as perguntas da feature antes de avançar.',
          );
      }
      if (card.status === 'done' && status !== 'done') {
        const blockers = await manager
          .createQueryBuilder(FeatureCard, 'card')
          .where('card.project_id = :projectId AND card.active = true', {
            projectId,
          })
          .andWhere(
            "((card.depends_on @> CAST(:dependency AS jsonb) AND card.status IN ('in_progress', 'review', 'done')) OR (card.id = :parentId AND card.status = 'done'))",
            { dependency: JSON.stringify([id]), parentId: card.parentId },
          )
          .getCount();
        if (blockers)
          throw new BadRequestException(
            'Reabra primeiro a feature ou os cards dependentes.',
          );
      }
      card.content = content;
      card.status = status;
      if (dto.title !== undefined) {
        if (!dto.title.trim())
          throw new BadRequestException('Informe um título.');
        card.title = dto.title.trim();
      }
      card.version += 1;
      await manager.save(FeatureCard, card);
      await manager.save(FeatureCardRevision, cardRevision(card, user.id));
      return card;
    });
  }
}
