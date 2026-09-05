import { NotFoundException } from '@nestjs/common';
import { ChatMessage } from '../../../chat/chat-message.entity';
import { ChatThread } from '../../../chat/chat-thread.entity';
import { Project } from '../../../projects/project.entity';
import { FeatureCard } from '../../entities/feature-card.entity';
import { FeatureCardRevision } from '../../entities/feature-card-revision.entity';
import { proposalFixture } from '../shared/card-test-fixture';
import { SaveProposalUseCase } from './save-proposal.use-case';

const user = { id: 'u', email: 'u@example.com', username: 'u' };

function setup() {
  const proposal = proposalFixture();
  const citation = { repoId: 'acme/api', sha: 'abc', path: 'src/a.ts', line: 4, symbolId: null, symbolName: null };
  proposal.tasks[0].evidence = [citation, { ...citation, repoId: 'private/other' }];
  const source = { id: 'm', threadId: 't', proposal, citations: [citation] };
  const manager = {
    findOne: jest.fn(async (entity) => entity === Project ? { id: 'p' } : entity === ChatMessage ? source : entity === ChatThread ? { scope: { repositories: [{ repoId: 'acme/api', sha: 'abc', included: true }] } } : null),
    find: jest.fn(async () => [] as FeatureCard[]),
    save: jest.fn(async (_entity, value) => value),
  };
  const transaction = jest.fn(async (fn) => fn(manager));
  const projects = { getById: jest.fn(async () => ({ id: 'p' })) };
  const useCase = new SaveProposalUseCase({ datasource: { transaction } } as never, projects as never);
  return { useCase, manager, projects, source, transaction };
}

describe('SaveProposalUseCase', () => {
  it('creates one family atomically, resolves dependency IDs and snapshots revisions', async () => {
    const { useCase, manager, transaction } = setup();
    const cards = await useCase.execute('p', 'm', user);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(cards).toHaveLength(3);
    expect(cards[1].parentId).toBe(cards[0].id);
    expect(cards[2].dependsOn).toEqual([cards[1].id]);
    expect(cards.every((card) => card.status === 'draft' && card.version === 1)).toBe(true);
    expect(manager.save.mock.calls.filter(([entity]) => entity === FeatureCardRevision)[0][1]).toHaveLength(3);
  });
  it('discards evidence from outside the persisted message and scope', async () => {
    const { useCase } = setup();
    const cards = await useCase.execute('p', 'm', user);
    expect(cards[1].snapshot.evidence).toHaveLength(1);
    expect(cards[1].snapshot.evidence[0].sha).toBe('abc');
    expect(cards[2].snapshot.confidence).toBe('hypothesis');
  });
  it('returns existing cards on repeated save without writing', async () => {
    const { useCase, manager } = setup();
    const existing = [new FeatureCard({ id: 'existing' })];
    manager.find.mockResolvedValue(existing);
    expect(await useCase.execute('p', 'm', user)).toEqual(existing);
    expect(manager.save).not.toHaveBeenCalled();
  });
  it('rejects a message owned by another thread or project', async () => {
    const { useCase, manager } = setup();
    manager.findOne.mockImplementation(async (entity) => entity === Project ? { id: 'p' } : null);
    await expect(useCase.execute('p', 'm', user)).rejects.toBeInstanceOf(NotFoundException);
    expect(manager.save).not.toHaveBeenCalled();
    expect(manager.findOne).toHaveBeenCalledWith(Project, expect.objectContaining({ where: { id: 'p', ownerId: 'u', active: true }, lock: { mode: 'pessimistic_write' } }));
  });
  it('does not enter a transaction when project ownership is denied', async () => {
    const { useCase, projects, transaction } = setup();
    projects.getById.mockRejectedValue(new NotFoundException());
    await expect(useCase.execute('p', 'm', user)).rejects.toBeInstanceOf(NotFoundException);
    expect(transaction).not.toHaveBeenCalled();
  });
});
