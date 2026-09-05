import { ConflictException, NotFoundException } from '@nestjs/common';
import { Project } from '../../../projects/project.entity';
import { FeatureCard } from '../../entities/feature-card.entity';
import { FeatureCardRevision } from '../../entities/feature-card-revision.entity';
import { UpdateCardUseCase } from './update-card.use-case';

const user = { id: 'u', email: 'u@example.com', username: 'u' };
function setup() {
  const card = new FeatureCard({ id: 'c', projectId: 'p', parentId: null, version: 1, status: 'draft', title: 'Inbox', dependsOn: [], content: { description: 'Criar', rationale: 'Consultar', scope: [], outOfScope: [], businessRules: [], acceptanceCriteria: ['Visível'], edgeCases: [], openQuestions: [] } });
  const manager = {
    findOne: jest.fn(async (entity) => entity === Project ? { id: 'p' } : card),
    find: jest.fn(async () => [] as FeatureCard[]), save: jest.fn(async (_entity, row) => row),
  };
  const useCase = new UpdateCardUseCase({ datasource: { transaction: (fn: (m: unknown) => unknown) => fn(manager) } } as never, {} as never);
  return { useCase, manager, card };
}

describe('UpdateCardUseCase', () => {
  it('updates the version and records an immutable revision', async () => {
    const { useCase, manager, card } = setup();
    await useCase.execute('p', 'c', { version: 1, title: 'Nova inbox', status: 'ready' }, user);
    expect(card.version).toBe(2);
    const revision = manager.save.mock.calls.find(([entity]) => entity === FeatureCardRevision)![1];
    card.title = 'Depois';
    expect(revision.snapshot.title).toBe('Nova inbox');
  });
  it('rejects stale versions without writing', async () => {
    const { useCase, manager } = setup();
    await expect(useCase.execute('p', 'c', { version: 2, status: 'done' }, user)).rejects.toBeInstanceOf(ConflictException);
    expect(manager.save).not.toHaveBeenCalled();
  });
  it('rejects another project before reading the card', async () => {
    const { useCase, manager } = setup();
    manager.findOne.mockResolvedValue(null as never);
    await expect(useCase.execute('other', 'c', { version: 1 }, user)).rejects.toBeInstanceOf(NotFoundException);
    expect(manager.findOne).toHaveBeenCalledTimes(1);
  });
  it('does not conclude a feature with unfinished children', async () => {
    const { useCase, manager } = setup();
    manager.find.mockResolvedValue([new FeatureCard({ status: 'review' })]);
    await expect(useCase.execute('p', 'c', { version: 1, status: 'done' }, user)).rejects.toThrow('filhos');
    expect(manager.save).not.toHaveBeenCalled();
  });
});
