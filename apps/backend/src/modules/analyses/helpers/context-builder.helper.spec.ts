import type { CurrentUserData } from '../../auth/utils/current-user-decorator';
import type { RepositoriesService } from '../../repositories/repositories.service';
import type { RunAnalysisDto } from '../dtos/run-analysis.dto';
import { buildAgentRunRequest } from './context-builder.helper';

function fakeRepositoriesService(): RepositoriesService {
  return {
    getPullByNumber: jest.fn().mockResolvedValue({ headRef: 'main', headSha: 'sha-abc123' }),
    getPullDiff: jest.fn().mockResolvedValue('diff --git a/a b/a'),
    listPullFiles: jest.fn().mockResolvedValue([]),
    getConventions: jest.fn().mockResolvedValue('conventions'),
    getFileContent: jest.fn().mockResolvedValue(''),
    loginFor: jest.fn().mockResolvedValue('octocat'),
  } as unknown as RepositoriesService;
}

const currentUser: CurrentUserData = {
  id: 'user-1',
  username: 'octocat',
  email: 'octocat@example.com',
};

function baseDto(overrides: Partial<RunAnalysisDto> = {}): RunAnalysisDto {
  return {
    models: { testReviewer: 'gpt-4', architectureReviewer: 'gpt-4' },
    apiKeys: { openai: 'sk-test' },
    ...overrides,
  } as RunAnalysisDto;
}

describe('buildAgentRunRequest', () => {
  it('includes the passed-in analysisId in the payload', async () => {
    const repositoriesService = fakeRepositoriesService();

    const payload = await buildAgentRunRequest(
      repositoriesService,
      'my-repo',
      42,
      currentUser,
      baseDto(),
      'analysis-123',
    );

    expect(payload.analysisId).toBe('analysis-123');
  });

  it('carries the DTO policies verbatim when provided', async () => {
    const repositoriesService = fakeRepositoriesService();
    const dto = baseDto({ policies: { prd: 'auto', spec: 'manual' } });

    const payload = await buildAgentRunRequest(
      repositoriesService,
      'my-repo',
      42,
      currentUser,
      dto,
      'analysis-123',
    );

    expect(payload.policies).toEqual({ prd: 'auto', spec: 'manual' });
  });

  it('defaults policies to manual/manual when omitted from the DTO', async () => {
    const repositoriesService = fakeRepositoriesService();

    const payload = await buildAgentRunRequest(
      repositoriesService,
      'my-repo',
      42,
      currentUser,
      baseDto(),
      'analysis-123',
    );

    expect(payload.policies).toEqual({ prd: 'manual', spec: 'manual' });
  });

  it('defaults a single missing field within policies to manual', async () => {
    const repositoriesService = fakeRepositoriesService();
    const dto = baseDto({ policies: { spec: 'auto' } });

    const payload = await buildAgentRunRequest(
      repositoriesService,
      'my-repo',
      42,
      currentUser,
      dto,
      'analysis-123',
    );

    expect(payload.policies).toEqual({ prd: 'manual', spec: 'auto' });
  });

  it('includes repoId (owner/repo, via loginFor session owner) and sha (PR head) for the code graph', async () => {
    const repositoriesService = fakeRepositoriesService();

    const payload = await buildAgentRunRequest(
      repositoriesService,
      'my-repo',
      42,
      currentUser,
      baseDto(),
      'analysis-123',
    );

    expect(repositoriesService.loginFor).toHaveBeenCalledWith(currentUser);
    expect(payload.repoId).toBe('octocat/my-repo');
    expect(payload.sha).toBe('sha-abc123');
  });

  it('uses the owner override instead of calling loginFor when provided', async () => {
    const repositoriesService = fakeRepositoriesService();

    const payload = await buildAgentRunRequest(
      repositoriesService,
      'my-repo',
      42,
      currentUser,
      baseDto(),
      'analysis-123',
      'some-org',
    );

    expect(repositoriesService.loginFor).not.toHaveBeenCalled();
    expect(payload.repoId).toBe('some-org/my-repo');
  });
});
