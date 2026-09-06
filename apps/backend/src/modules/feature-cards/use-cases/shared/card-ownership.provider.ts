import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import { Project } from '../../../projects/project.entity';

export class CardOwnershipProvider {
  async lock(manager: EntityManager, projectId: string, user: CurrentUserData) {
    const project = await manager.findOne(Project, {
      where: { id: projectId, ownerId: user.id, active: true },
      lock: { mode: 'pessimistic_write' },
    });
    if (!project) throw new NotFoundException('Projeto não encontrado.');
    return project;
  }
}
