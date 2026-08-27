import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import { ListPullFilesUseCase } from './list-pull-files.use-case';

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

describe('ListPullFilesUseCase', () => {
  it('maps paginated pull files to the filename/status/patch shape', async () => {
    const octokit = {
      pulls: { listFiles: jest.fn() },
      paginate: jest.fn().mockResolvedValue([
        { filename: 'src/a.ts', status: 'modified', patch: '@@ -1 +1 @@' },
      ]),
    };
    const useCase = new ListPullFilesUseCase(fakeGithubSession(octokit));

    const result = await useCase.execute({
      repo: 'hello-world',
      pullNumber: 7,
      currentUser,
    });

    expect(octokit.paginate).toHaveBeenCalledWith(octokit.pulls.listFiles, {
      owner: 'octocat',
      repo: 'hello-world',
      pull_number: 7,
      per_page: 100,
    });
    expect(result).toEqual([
      { filename: 'src/a.ts', status: 'modified', patch: '@@ -1 +1 @@' },
    ]);
  });

  it('delegates github errors to the session handler', async () => {
    const err = { status: 403 };
    const octokit = {
      pulls: { listFiles: jest.fn() },
      paginate: jest.fn().mockRejectedValue(err),
    };
    const githubSession = fakeGithubSession(octokit);
    const useCase = new ListPullFilesUseCase(githubSession);

    await expect(
      useCase.execute({ repo: 'hello-world', pullNumber: 7, currentUser }),
    ).rejects.toEqual(err);
    expect(githubSession.handleGithubError).toHaveBeenCalledWith(err);
  });
});
