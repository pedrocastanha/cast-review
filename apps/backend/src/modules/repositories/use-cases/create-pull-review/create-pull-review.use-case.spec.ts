import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import { CreatePullReviewUseCase } from './create-pull-review.use-case';

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

describe('CreatePullReviewUseCase', () => {
  it('creates a review with inline comments mapped to the Github payload shape', async () => {
    const octokit = {
      pulls: {
        createReview: jest
          .fn()
          .mockResolvedValue({ data: { id: 1, html_url: 'https://x' } }),
      },
    };
    const useCase = new CreatePullReviewUseCase(fakeGithubSession(octokit));

    const result = await useCase.execute({
      repo: 'hello-world',
      pullNumber: 7,
      input: {
        commitId: 'sha-head',
        body: 'LGTM',
        comments: [{ path: 'src/a.ts', line: 10, body: 'nit', startLine: 8 }],
      },
      currentUser,
    });

    expect(octokit.pulls.createReview).toHaveBeenCalledWith({
      owner: 'octocat',
      repo: 'hello-world',
      pull_number: 7,
      commit_id: 'sha-head',
      event: 'COMMENT',
      body: 'LGTM',
      comments: [
        {
          path: 'src/a.ts',
          body: 'nit',
          line: 10,
          side: 'RIGHT',
          start_line: 8,
          start_side: 'RIGHT',
        },
      ],
    });
    expect(result).toEqual({ id: 1, htmlUrl: 'https://x' });
  });

  it('omits the comments field when there are no inline comments', async () => {
    const octokit = {
      pulls: {
        createReview: jest
          .fn()
          .mockResolvedValue({ data: { id: 1, html_url: null } }),
      },
    };
    const useCase = new CreatePullReviewUseCase(fakeGithubSession(octokit));

    await useCase.execute({
      repo: 'hello-world',
      pullNumber: 7,
      input: { commitId: 'sha-head', body: 'LGTM', comments: [] },
      currentUser,
    });

    expect(octokit.pulls.createReview).toHaveBeenCalledWith(
      expect.not.objectContaining({ comments: expect.anything() }),
    );
  });

  it('delegates github errors to the session handler', async () => {
    const err = { status: 422 };
    const octokit = {
      pulls: { createReview: jest.fn().mockRejectedValue(err) },
    };
    const githubSession = fakeGithubSession(octokit);
    const useCase = new CreatePullReviewUseCase(githubSession);

    await expect(
      useCase.execute({
        repo: 'hello-world',
        pullNumber: 7,
        input: { commitId: 'sha-head', body: 'LGTM', comments: [] },
        currentUser,
      }),
    ).rejects.toEqual(err);
    expect(githubSession.handleGithubError).toHaveBeenCalledWith(err);
  });
});
