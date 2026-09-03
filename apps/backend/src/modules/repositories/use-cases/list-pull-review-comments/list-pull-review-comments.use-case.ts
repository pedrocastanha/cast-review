import type { GithubSessionSource } from '../shared/github-session.provider';
import { ListPullReviewCommentsDto } from './list-pull-review-comments.dto';

export class ListPullReviewCommentsUseCase {
  constructor(private readonly githubSession: GithubSessionSource) {}

  async execute({
    repo,
    pullNumber,
    currentUser,
    ownerOverride,
  }: ListPullReviewCommentsDto) {
    const session = await this.githubSession.getSession(currentUser);
    const owner = this.githubSession.resolveOwner(session, ownerOverride);

    try {
      const comments = await session.octokit.paginate(
        session.octokit.pulls.listReviewComments,
        { owner, repo, pull_number: pullNumber, per_page: 100 },
      );
      return comments.map((comment) => ({
        id: comment.id,
        body: comment.body,
        user: comment.user?.login ?? null,
      }));
    } catch (err) {
      this.githubSession.handleGithubError(err);
    }
  }
}
