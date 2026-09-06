import { NotFoundException } from '@nestjs/common';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import type { ProjectsService } from '../../../projects/projects.service';
import { FeatureCard } from '../../entities/feature-card.entity';
import { FeatureCardRevision } from '../../entities/feature-card-revision.entity';
import type { FeatureCardRepository } from '../../infrastructure/persistence/feature-card.repository';

export class ListCardHistoryUseCase {
  constructor(
    private readonly repository: FeatureCardRepository,
    private readonly projects: ProjectsService,
  ) {}

  async execute(projectId: string, id: string, user: CurrentUserData) {
    await this.projects.getById(projectId, user);
    const card = await this.repository.datasource
      .getRepository(FeatureCard)
      .findOne({ where: { id, projectId } });
    if (!card) throw new NotFoundException('Card não encontrado.');
    return this.repository.datasource
      .getRepository(FeatureCardRevision)
      .find({ where: { cardId: id }, order: { version: 'DESC' }, take: 100 });
  }
}
