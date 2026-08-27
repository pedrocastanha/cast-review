import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import { ListReposUseCase } from './list-repos.use-case';

const currentUser: CurrentUserData = {
  id: 'user-1',
  username: 'octocat',
  email: 'octocat@example.com',
};

function fakeGithubSession(octokit: any) {
  return {
    getSession: jest.fn().mockResolvedValue({ octokit, owner: 'octocat' }),
    handleGithubError: jest.fn((err) => {
      throw err;
    }),
  } as any;
}

describe('ListReposUseCase', () => {
  it('maps the authenticated user repos to the summary shape', async () => {
    const octokit = {
      repos: { listForAuthenticatedUser: jest.fn() },
      paginate: jest.fn().mockResolvedValue([
        {
          id: 1,
          name: 'hello-world',
          full_name: 'octocat/hello-world',
          owner: { login: 'octocat' },
          private: false,
          description: 'desc',
          html_url: 'https://github.com/octocat/hello-world',
          updated_at: '2024-01-01T00:00:00Z',
          default_branch: 'main',
        },
      ]),
    };
    const useCase = new ListReposUseCase(fakeGithubSession(octokit));

    const result = await useCase.execute({ currentUser });

    expect(octokit.paginate).toHaveBeenCalledWith(
      octokit.repos.listForAuthenticatedUser,
      {
        per_page: 100,
        sort: 'updated',
        affiliation: 'owner,collaborator,organization_member',
      },
    );
    expect(result).toEqual([
      {
        id: 1,
        name: 'hello-world',
        fullName: 'octocat/hello-world',
        owner: 'octocat',
        private: false,
        description: 'desc',
        htmlUrl: 'https://github.com/octocat/hello-world',
        updatedAt: '2024-01-01T00:00:00Z',
        defaultBranch: 'main',
      },
    ]);
  });

  it('delegates github errors to the session handler', async () => {
    const err = { status: 404 };
    const octokit = {
      repos: { listForAuthenticatedUser: jest.fn() },
      paginate: jest.fn().mockRejectedValue(err),
    };
    const githubSession = fakeGithubSession(octokit);
    const useCase = new ListReposUseCase(githubSession);

    await expect(useCase.execute({ currentUser })).rejects.toEqual(err);
    expect(githubSession.handleGithubError).toHaveBeenCalledWith(err);
  });
});
