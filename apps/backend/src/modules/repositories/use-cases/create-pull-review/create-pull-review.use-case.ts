import type { GithubSessionSource } from '../shared/github-session.provider';
import { CreatePullReviewDto } from './create-pull-review.dto';

export class CreatePullReviewUseCase {
  constructor(private readonly githubSession: GithubSessionSource) {}

  async execute({
    repo,
    pullNumber,
    input,
    currentUser,
    ownerOverride,
  }: CreatePullReviewDto): Promise<{ id: number; htmlUrl: string | null }> {
    const session = await this.githubSession.getSession(currentUser);
    const owner = this.githubSession.resolveOwner(session, ownerOverride);

    try {
      const { data } = await session.octokit.pulls.createReview({
        owner,
        repo,
        pull_number: pullNumber,
        commit_id: input.commitId,
        event: 'COMMENT',
        body: input.body,
        ...(input.comments.length > 0
          ? {
              comments: input.comments.map((comment) => ({
                path: comment.path,
                body: comment.body,
                line: comment.line,
                side: 'RIGHT' as const,
                ...(comment.startLine
                  ? {
                      start_line: comment.startLine,
                      start_side: 'RIGHT' as const,
                    }
                  : {}),
              })),
            }
          : {}),
      });

      return { id: data.id, htmlUrl: data.html_url ?? null };
    } catch (err) {
      this.githubSession.handleGithubError(err);
    }
  }
}
