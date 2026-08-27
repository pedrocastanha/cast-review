import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import { GetRepositoryGraphUseCase } from './get-repository-graph.use-case';

const currentUser: CurrentUserData = {
  id: 'user-1',
  username: 'octocat',
  email: 'octocat@example.com',
};

function fakeGithubSession(owner = 'octocat') {
  return {
    getSession: jest.fn().mockResolvedValue({ octokit: {}, owner }),
  } as any;
}

function fakeAiApiClient(status = { indexed: false, sha: null as string | null }) {
  return {
    getIndexStatus: jest.fn().mockResolvedValue(status),
    getGraph: jest.fn(),
  } as any;
}

describe('GetRepositoryGraphUseCase', () => {
  it('uses the provided sha directly, without calling getIndexStatus', async () => {
    const aiApiClient = fakeAiApiClient();
    aiApiClient.getGraph.mockResolvedValue({
      nodes: [],
      edges: [],
      stats: { indexed: true },
    });
    const useCase = new GetRepositoryGraphUseCase(
      fakeGithubSession(),
      aiApiClient,
    );

    await useCase.execute({
      repo: 'hello-world',
      currentUser,
      sha: 'sha1',
      focus: 'focus-id',
      depth: 2,
    });

    expect(aiApiClient.getIndexStatus).not.toHaveBeenCalled();
    expect(aiApiClient.getGraph).toHaveBeenCalledWith(
      'octocat/hello-world',
      'sha1',
      'focus-id',
      2,
    );
  });

  it('falls back to the latest indexed sha when none is provided', async () => {
    const aiApiClient = fakeAiApiClient({ indexed: true, sha: 'latest-sha' });
    aiApiClient.getGraph.mockResolvedValue({
      nodes: [],
      edges: [],
      stats: { indexed: true },
    });
    const useCase = new GetRepositoryGraphUseCase(
      fakeGithubSession(),
      aiApiClient,
    );

    await useCase.execute({ repo: 'hello-world', currentUser });

    expect(aiApiClient.getIndexStatus).toHaveBeenCalledWith(
      'octocat/hello-world',
    );
    expect(aiApiClient.getGraph).toHaveBeenCalledWith(
      'octocat/hello-world',
      'latest-sha',
      undefined,
      undefined,
    );
  });

  it('returns an empty not-indexed graph without calling getGraph when repo was never indexed', async () => {
    const aiApiClient = fakeAiApiClient({ indexed: false, sha: null });
    const useCase = new GetRepositoryGraphUseCase(
      fakeGithubSession(),
      aiApiClient,
    );

    const result = await useCase.execute({ repo: 'hello-world', currentUser });

    expect(aiApiClient.getGraph).not.toHaveBeenCalled();
    expect(result).toEqual({ nodes: [], edges: [], stats: { indexed: false } });
  });
});
