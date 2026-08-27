import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import { GetPullByNumberUseCase } from './get-pull-by-number.use-case';

const currentUser: CurrentUserData = {
  id: 'user-1',
  username: 'octocat',
  email: 'octocat@example.com',
};

function fakeGithubSession(octokit: any, owner = 'octocat') {
  return {
    getSession: jest.fn().mockResolvedValue({ octokit, owner }),
    resolveOwner: jest.fn(
      (session, ownerOverride) => ownerOverride?.trim() || session.owner,
    ),
    handleGithubError: jest.fn((err) => {
      throw err;
    }),
  } as any;
}

describe('GetPullByNumberUseCase', () => {
  it('fetches the pull and maps it to the summary shape', async () => {
    const octokit = {
      pulls: {
        get: jest.fn().mockResolvedValue({
          data: {
            id: 1,
            number: 7,
            title: 'Add feature',
            state: 'open',
            user: { login: 'octocat' },
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-02T00:00:00Z',
            html_url: 'https://github.com/octocat/hello-world/pull/7',
            head: { ref: 'feature', sha: 'sha-head' },
            base: { ref: 'main', sha: 'sha-base' },
          },
        }),
      },
    };
    const useCase = new GetPullByNumberUseCase(fakeGithubSession(octokit));

    const result = await useCase.execute({
      repo: 'hello-world',
      pullNumber: 7,
      currentUser,
    });

    expect(octokit.pulls.get).toHaveBeenCalledWith({
      owner: 'octocat',
      repo: 'hello-world',
      pull_number: 7,
    });
    expect(result).toMatchObject({ id: 1, number: 7, draft: false });
  });

  it('delegates github errors to the session handler', async () => {
    const err = { status: 404 };
    const octokit = { pulls: { get: jest.fn().mockRejectedValue(err) } };
    const githubSession = fakeGithubSession(octokit);
    const useCase = new GetPullByNumberUseCase(githubSession);

    await expect(
      useCase.execute({ repo: 'hello-world', pullNumber: 7, currentUser }),
    ).rejects.toEqual(err);
    expect(githubSession.handleGithubError).toHaveBeenCalledWith(err);
  });
});
