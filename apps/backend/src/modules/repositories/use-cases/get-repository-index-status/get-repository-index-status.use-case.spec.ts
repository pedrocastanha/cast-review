import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import { GetRepositoryIndexStatusUseCase } from './get-repository-index-status.use-case';

const currentUser: CurrentUserData = {
  id: 'user-1',
  username: 'octocat',
  email: 'octocat@example.com',
};

function fakeGithubSession(headSha = 'head-sha') {
  return {
    getSession: jest.fn().mockResolvedValue({ octokit: {}, owner: 'octocat' }),
    resolveOwner: jest.fn(
      (session, ownerOverride) => ownerOverride?.trim() || session.owner,
    ),
    resolveDefaultBranchSha: jest.fn().mockResolvedValue(headSha),
    handleGithubError: jest.fn((err) => {
      throw err;
    }),
  } as any;
}

function fakeQueue(job: any = null) {
  return { getJob: jest.fn().mockResolvedValue(job) } as any;
}

function fakeAiApiClient(status = { indexed: false, sha: null as string | null }) {
  return { getIndexStatus: jest.fn().mockResolvedValue(status) } as any;
}

describe('GetRepositoryIndexStatusUseCase', () => {
  it('returns not_indexed when there is no active job and ai-api has never indexed the repo', async () => {
    const aiApiClient = fakeAiApiClient({ indexed: false, sha: null });
    const useCase = new GetRepositoryIndexStatusUseCase(
      fakeGithubSession('head-sha'),
      fakeQueue(null),
      aiApiClient,
    );

    const result = await useCase.execute({ repo: 'hello-world', currentUser });

    expect(aiApiClient.getIndexStatus).toHaveBeenCalledWith(
      'octocat/hello-world',
    );
    expect(result).toEqual({ status: 'not_indexed', sha: null, stale: false });
  });

  it('returns indexed + stale=true when the indexed sha is behind HEAD', async () => {
    const aiApiClient = fakeAiApiClient({ indexed: true, sha: 'old-sha' });
    const useCase = new GetRepositoryIndexStatusUseCase(
      fakeGithubSession('head-sha'),
      fakeQueue(null),
      aiApiClient,
    );

    const result = await useCase.execute({ repo: 'hello-world', currentUser });

    expect(result).toEqual({ status: 'indexed', sha: 'old-sha', stale: true });
  });

  it('returns indexing (not ai-api status) when a job is currently active', async () => {
    const job = { getState: jest.fn().mockResolvedValue('active'), progress: 50 };
    const useCase = new GetRepositoryIndexStatusUseCase(
      fakeGithubSession('head-sha'),
      fakeQueue(job),
      fakeAiApiClient(),
    );

    const result = await useCase.execute({ repo: 'hello-world', currentUser });

    expect(result).toEqual({
      status: 'indexing',
      sha: null,
      stale: false,
      progress: 50,
    });
  });

  it('delegates github errors to the session handler', async () => {
    const err = { status: 500 };
    const githubSession = fakeGithubSession('head-sha');
    githubSession.resolveDefaultBranchSha.mockRejectedValue(err);
    const useCase = new GetRepositoryIndexStatusUseCase(
      githubSession,
      fakeQueue(null),
      fakeAiApiClient(),
    );

    await expect(
      useCase.execute({ repo: 'hello-world', currentUser }),
    ).rejects.toEqual(err);
    expect(githubSession.handleGithubError).toHaveBeenCalledWith(err);
  });
});
