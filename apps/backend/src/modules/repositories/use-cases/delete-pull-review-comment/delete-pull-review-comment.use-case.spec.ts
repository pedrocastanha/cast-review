import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import { DeletePullReviewCommentUseCase } from './delete-pull-review-comment.use-case';

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

describe('DeletePullReviewCommentUseCase', () => {
  it('deletes the review comment by id', async () => {
    const octokit = { pulls: { deleteReviewComment: jest.fn() } };
    const useCase = new DeletePullReviewCommentUseCase(
      fakeGithubSession(octokit),
    );

    await useCase.execute({
      repo: 'hello-world',
      commentId: 42,
      currentUser,
    });

    expect(octokit.pulls.deleteReviewComment).toHaveBeenCalledWith({
      owner: 'octocat',
      repo: 'hello-world',
      comment_id: 42,
    });
  });

  it('delegates github errors to the session handler', async () => {
    const err = { status: 404 };
    const octokit = {
      pulls: { deleteReviewComment: jest.fn().mockRejectedValue(err) },
    };
    const githubSession = fakeGithubSession(octokit);
    const useCase = new DeletePullReviewCommentUseCase(githubSession);

    await expect(
      useCase.execute({ repo: 'hello-world', commentId: 42, currentUser }),
    ).rejects.toEqual(err);
    expect(githubSession.handleGithubError).toHaveBeenCalledWith(err);
  });
});
