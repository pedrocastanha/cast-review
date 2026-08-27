import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import { GetPullHeadShaUseCase } from './get-pull-head-sha.use-case';

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

describe('GetPullHeadShaUseCase', () => {
  it('returns the head sha of the pull', async () => {
    const octokit = {
      pulls: {
        get: jest.fn().mockResolvedValue({ data: { head: { sha: 'sha-head' } } }),
      },
    };
    const useCase = new GetPullHeadShaUseCase(fakeGithubSession(octokit));

    const result = await useCase.execute({
      repo: 'hello-world',
      pullNumber: 7,
      currentUser,
    });

    expect(result).toBe('sha-head');
  });

  it('delegates github errors to the session handler', async () => {
    const err = { status: 404 };
    const octokit = { pulls: { get: jest.fn().mockRejectedValue(err) } };
    const githubSession = fakeGithubSession(octokit);
    const useCase = new GetPullHeadShaUseCase(githubSession);

    await expect(
      useCase.execute({ repo: 'hello-world', pullNumber: 7, currentUser }),
    ).rejects.toEqual(err);
    expect(githubSession.handleGithubError).toHaveBeenCalledWith(err);
  });
});
