import type { GithubSessionSource } from '../shared/github-session.provider';
import { toPullSummary } from '../shared/pull-summary.helper';
import { GetPullByNumberDto } from './get-pull-by-number.dto';

export class GetPullByNumberUseCase {
  constructor(private readonly githubSession: GithubSessionSource) {}

  async execute({
    repo,
    pullNumber,
    currentUser,
    ownerOverride,
  }: GetPullByNumberDto) {
    const session = await this.githubSession.getSession(currentUser);
    const owner = this.githubSession.resolveOwner(session, ownerOverride);

    try {
      const { data } = await session.octokit.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
      });

      return toPullSummary(data);
    } catch (err) {
      this.githubSession.handleGithubError(err);
    }
  }
}
