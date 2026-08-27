import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import { ListPullsUseCase } from './list-pulls.use-case';

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

const rawPull = {
  id: 1,
  number: 7,
  title: 'Add feature',
  state: 'open',
  user: { login: 'octocat' },
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-02T00:00:00Z',
  html_url: 'https://github.com/octocat/hello-world/pull/7',
  draft: false,
  head: { ref: 'feature', sha: 'sha-head' },
  base: { ref: 'main', sha: 'sha-base' },
};

describe('ListPullsUseCase', () => {
  it('lists pulls for the session owner using the summary shape', async () => {
    const octokit = { pulls: { list: jest.fn() }, paginate: jest.fn().mockResolvedValue([rawPull]) };
    const githubSession = fakeGithubSession(octokit);
    const useCase = new ListPullsUseCase(githubSession);

    const result = await useCase.execute({ repo: 'hello-world', currentUser });

    expect(octokit.paginate).toHaveBeenCalledWith(octokit.pulls.list, {
      owner: 'octocat',
      repo: 'hello-world',
      per_page: 100,
      sort: 'updated',
      direction: 'desc',
      state: 'all',
    });
    expect(result[0]).toMatchObject({ id: 1, number: 7, headRef: 'feature' });
  });

  it('uses the owner override instead of the session owner', async () => {
    const octokit = { pulls: { list: jest.fn() }, paginate: jest.fn().mockResolvedValue([]) };
    const githubSession = fakeGithubSession(octokit);
    const useCase = new ListPullsUseCase(githubSession);

    await useCase.execute({ repo: 'hello-world', currentUser, ownerOverride: 'some-org' });

    expect(octokit.paginate).toHaveBeenCalledWith(
      octokit.pulls.list,
      expect.objectContaining({ owner: 'some-org' }),
    );
  });

  it('delegates github errors to the session handler', async () => {
    const err = { status: 500 };
    const octokit = {
      pulls: { list: jest.fn() },
      paginate: jest.fn().mockRejectedValue(err),
    };
    const githubSession = fakeGithubSession(octokit);
    const useCase = new ListPullsUseCase(githubSession);

    await expect(
      useCase.execute({ repo: 'hello-world', currentUser }),
    ).rejects.toEqual(err);
    expect(githubSession.handleGithubError).toHaveBeenCalledWith(err);
  });
});
