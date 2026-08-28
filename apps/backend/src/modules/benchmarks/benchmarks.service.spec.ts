import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { BenchmarksService } from './benchmarks.service';

function repository() {
  return {
    create: jest.fn((value) => value),
    save: jest.fn(async (value) => value),
    update: jest.fn().mockResolvedValue(undefined),
    findOne: jest.fn(),
    find: jest.fn(),
    delete: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

function buildService() {
  const analysisRepository = repository();
  const snapshotRepository = repository();
  const caseRepository = repository();
  const runRepository = repository();
  const aiApiClient = { runAgent: jest.fn() };
  const userService = { getOpenaiKey: jest.fn(async () => 'sk-do-banco') };
  const service = new BenchmarksService(
    analysisRepository as any,
    snapshotRepository as any,
    caseRepository as any,
    runRepository as any,
    aiApiClient as any,
    userService as any,
  );
  return {
    service,
    userService,
    analysisRepository,
    snapshotRepository,
    caseRepository,
    runRepository,
    aiApiClient,
  };
}

async function* events(
  items: Array<{ type: string; payload: Record<string, unknown> }>,
) {
  for (const item of items) yield item as any;
}

const user = { id: 'user-1', username: 'cast', email: 'cast@example.com' };
const graphSnapshot = {
  schemaVersion: '1',
  snapshotHash: 'graph-hash-1',
  repository: { repoId: 'cast/review', requestedSha: 'sha-1' },
  input: {
    diff: 'frozen diff',
    diffHash: 'diff-hash',
    changedFiles: [
      { path: 'src/a.ts', diff: '+a', fullContent: 'a', relatedFiles: [] },
    ],
    conventions: 'frozen rules',
  },
  selected: { nodes: [] },
  edges: [],
  rendered: { relatedContext: {}, graphContextBlock: '' },
};

describe('BenchmarksService', () => {
  it('lists curated cases together with only the current user private cases', async () => {
    const { service, caseRepository } = buildService();
    caseRepository.find.mockResolvedValue([]);

    await service.listCases(user);

    expect(caseRepository.find).toHaveBeenCalledWith({
      where: [{ kind: 'curated' }, { ownerId: user.id }],
      order: { createdAt: 'DESC' },
    });
  });

  it('keeps curated cases read-only for every user', async () => {
    const { service, caseRepository } = buildService();
    caseRepository.findOne.mockResolvedValue({
      id: 'official-case',
      kind: 'curated',
      ownerId: null,
    });

    await expect(
      service.deleteCase('official-case', user),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(caseRepository.delete).not.toHaveBeenCalled();
  });

  it('creates an independent private case from an owned analysis snapshot', async () => {
    const { service, analysisRepository, snapshotRepository, caseRepository } =
      buildService();
    analysisRepository.findOne.mockResolvedValue({
      id: 'analysis-1',
      requestedBy: user.id,
      owner: 'cast',
      repo: 'review',
      pullNumber: 12,
    });
    snapshotRepository.findOne.mockResolvedValue({ graphSnapshot });

    const result = await service.createFromAnalysis('analysis-1', user, {
      title: 'PR difícil',
    });

    expect(caseRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: user.id,
        kind: 'private',
        evaluationMode: 'exploratory',
        title: 'PR difícil',
        inputSnapshot: graphSnapshot.input,
        graphSnapshot,
      }),
    );
    expect(result.graphSnapshot).toEqual(graphSnapshot);
  });

  it('rejects creating a case from an analysis owned by someone else', async () => {
    const { service, analysisRepository } = buildService();
    analysisRepository.findOne.mockResolvedValue(null);

    await expect(
      service.createFromAnalysis('analysis-1', user, {}),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('runs every model against the same frozen snapshot without persisting the api key', async () => {
    const { service, caseRepository, runRepository, aiApiClient } =
      buildService();
    const benchmarkCase = {
      id: 'case-1',
      ownerId: user.id,
      kind: 'private',
      inputSnapshot: graphSnapshot.input,
      graphSnapshot,
    };
    caseRepository.findOne.mockResolvedValue(benchmarkCase);
    aiApiClient.runAgent.mockImplementation(() =>
      events([
        {
          type: 'report_ready',
          payload: {
            results: [],
            markdown: 'review',
            usage: { totalTokens: 10, costUsd: 0.01 },
          },
        },
      ]),
    );

    const result = await service.runCase('case-1', user, {
      models: ['gpt-5-mini', 'gpt-5.1'],
    });

    expect(aiApiClient.runAgent).toHaveBeenCalledTimes(2);
    for (const [payload] of aiApiClient.runAgent.mock.calls) {
      expect(payload.frozenContext.graphSnapshot.snapshotHash).toBe(
        'graph-hash-1',
      );
    }
    expect(result.graphSnapshotHash).toBe('graph-hash-1');
    expect(result.results).toHaveLength(2);
    expect(JSON.stringify(runRepository.save.mock.calls)).not.toContain(
      'sk-never-persist',
    );
    expect(JSON.stringify(runRepository.update.mock.calls)).not.toContain(
      'sk-never-persist',
    );
  });
});
