import type { GithubSessionSource } from '../shared/github-session.provider';
import { DeletePullReviewCommentDto } from './delete-pull-review-comment.dto';

export class DeletePullReviewCommentUseCase {
  constructor(private readonly githubSession: GithubSessionSource) {}

  async execute({
    repo,
    commentId,
    currentUser,
    ownerOverride,
  }: DeletePullReviewCommentDto) {
    const session = await this.githubSession.getSession(currentUser);
    const owner = this.githubSession.resolveOwner(session, ownerOverride);

    try {
      await session.octokit.pulls.deleteReviewComment({
        owner,
        repo,
        comment_id: commentId,
      });
    } catch (err) {
      this.githubSession.handleGithubError(err);
    }
  }
}
