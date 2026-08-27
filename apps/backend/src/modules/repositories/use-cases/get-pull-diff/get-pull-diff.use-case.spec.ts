import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import { GetPullDiffUseCase } from './get-pull-diff.use-case';

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

describe('GetPullDiffUseCase', () => {
  it('requests the diff media type and returns the raw diff text', async () => {
    const octokit = {
      pulls: { get: jest.fn().mockResolvedValue({ data: 'diff --git a b' }) },
    };
    const useCase = new GetPullDiffUseCase(fakeGithubSession(octokit));

    const result = await useCase.execute({
      repo: 'hello-world',
      pullNumber: 7,
      currentUser,
    });

    expect(octokit.pulls.get).toHaveBeenCalledWith({
      owner: 'octocat',
      repo: 'hello-world',
      pull_number: 7,
      mediaType: { format: 'diff' },
    });
    expect(result).toBe('diff --git a b');
  });

  it('delegates github errors to the session handler', async () => {
    const err = { status: 500 };
    const octokit = { pulls: { get: jest.fn().mockRejectedValue(err) } };
    const githubSession = fakeGithubSession(octokit);
    const useCase = new GetPullDiffUseCase(githubSession);

    await expect(
      useCase.execute({ repo: 'hello-world', pullNumber: 7, currentUser }),
    ).rejects.toEqual(err);
    expect(githubSession.handleGithubError).toHaveBeenCalledWith(err);
  });
});
