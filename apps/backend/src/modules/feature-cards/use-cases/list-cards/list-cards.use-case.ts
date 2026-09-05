import { MoreThan } from 'typeorm';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import type { ProjectsService } from '../../../projects/projects.service';
import type { BoardQueryDto } from '../../dtos/card.dto';
import { FeatureCard } from '../../entities/feature-card.entity';
import type { FeatureCardRepository } from '../../infrastructure/persistence/feature-card.repository';

export class ListCardsUseCase {
  constructor(
    private readonly repository: FeatureCardRepository,
    private readonly projects: ProjectsService,
  ) {}

  async execute(
    projectId: string,
    user: CurrentUserData,
    query: BoardQueryDto,
  ) {
    await this.projects.getById(projectId, user);
    const limit = query.limit ?? 100;
    const cards = await this.repository.datasource
      .getRepository(FeatureCard)
      .find({
        where: {
          projectId,
          active: true,
          ...(query.after ? { id: MoreThan(query.after) } : {}),
        },
        order: { id: 'ASC' },
        take: limit + 1,
      });
    const items = cards.slice(0, limit);
    return {
      items,
      nextCursor: cards.length > limit ? items.at(-1)?.id : null,
    };
  }
}
