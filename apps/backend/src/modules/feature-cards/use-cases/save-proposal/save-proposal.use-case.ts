import { NotFoundException } from '@nestjs/common';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import { ChatMessage } from '../../../chat/chat-message.entity';
import { ChatThread } from '../../../chat/chat-thread.entity';
import type { ProjectsService } from '../../../projects/projects.service';
import { validateProposal } from '../../domain/card.rules';
import { FeatureCard } from '../../entities/feature-card.entity';
import { FeatureCardRevision } from '../../entities/feature-card-revision.entity';
import type { FeatureCardRepository } from '../../infrastructure/persistence/feature-card.repository';
import { CardOwnershipProvider } from '../shared/card-ownership.provider';
import { cardRevision } from '../shared/card-revision';

export class SaveProposalUseCase {
  private readonly ownership: CardOwnershipProvider;
  constructor(
    private readonly repository: FeatureCardRepository,
    private readonly projects: ProjectsService,
  ) {
    this.ownership = new CardOwnershipProvider();
  }

  async execute(projectId: string, messageId: string, user: CurrentUserData) {
    await this.projects.getById(projectId, user);
    return this.repository.datasource.transaction(async (manager) => {
      await this.ownership.lock(manager, projectId, user);
      const message = await manager.findOne(ChatMessage, {
        where: { id: messageId, active: true, role: 'assistant' },
      });
      const thread =
        message &&
        (await manager.findOne(ChatThread, {
          where: {
            id: message.threadId,
            userId: user.id,
            projectId,
            active: true,
          },
        }));
      if (!message || !thread)
        throw new NotFoundException('Proposta não encontrada neste projeto.');
      const existing = await manager.find(FeatureCard, {
        where: { projectId, sourceMessageId: messageId },
      });
      if (existing.length) return existing;
      const proposal = validateProposal(message.proposal);
      const repositories = thread.scope.repositories;
      const evidence = (items: typeof message.citations) =>
        items.flatMap((item) => {
          const source = message.citations.find(
            (c) =>
              c.repoId === item.repoId &&
              c.path === item.path &&
              c.line === item.line &&
              c.symbolId === item.symbolId,
          );
          const repo = repositories.find(
            (r) => r.repoId === item.repoId && r.included && r.sha,
          );
          return source && repo ? [{ ...source, sha: repo.sha }] : [];
        });
      const parent = new FeatureCard({
        projectId,
        parentId: null,
        sourceMessageId: messageId,
        taskKey: 'feature',
        title: proposal.title,
        area: 'Feature',
        status: 'draft',
        version: 1,
        active: true,
        dependsOn: [],
        content: {
          description: proposal.problem,
          rationale: proposal.objective,
          scope: proposal.scope,
          outOfScope: proposal.outOfScope,
          businessRules: proposal.businessRules,
          acceptanceCriteria: proposal.acceptanceCriteria,
          edgeCases: proposal.edgeCases,
          openQuestions: proposal.openQuestions,
        },
        snapshot: {
          threadId: thread.id,
          repositories,
          evidence: evidence(message.citations),
          confidence: 'hypothesis',
        },
      });
      const children = proposal.tasks.map((task) => {
        const sources = evidence(task.evidence);
        return new FeatureCard({
          projectId,
          parentId: parent.id,
          sourceMessageId: messageId,
          taskKey: task.key,
          title: task.title,
          area: task.area,
          status: 'draft',
          version: 1,
          active: true,
          dependsOn: [],
          content: {
            description: task.description,
            rationale: task.rationale,
            scope: [],
            outOfScope: [],
            businessRules: [],
            acceptanceCriteria: task.acceptanceCriteria,
            edgeCases: [],
            openQuestions: [],
          },
          snapshot: {
            threadId: thread.id,
            repositories,
            evidence: sources,
            confidence: sources.length ? 'grounded' : 'hypothesis',
          },
        });
      });
      children.forEach((card, i) => {
        card.dependsOn = proposal.tasks[i].dependsOn.map(
          (key) => children.find((c) => c.taskKey === key)!.id,
        );
      });
      await manager.save(FeatureCard, parent);
      await manager.save(FeatureCard, children);
      const cards = [parent, ...children];
      await manager.save(
        FeatureCardRevision,
        cards.map((card) => cardRevision(card, user.id)),
      );
      return cards;
    });
  }
}
