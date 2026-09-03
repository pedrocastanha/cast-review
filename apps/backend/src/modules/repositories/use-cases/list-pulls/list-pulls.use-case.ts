import type { GithubSessionSource } from '../shared/github-session.provider';
import { toPullSummary } from '../shared/pull-summary.helper';
import { ListPullsDto } from './list-pulls.dto';

export class ListPullsUseCase {
  constructor(private readonly githubSession: GithubSessionSource) {}

  async execute({ repo, currentUser, ownerOverride }: ListPullsDto) {
    const session = await this.githubSession.getSession(currentUser);
    const owner = this.githubSession.resolveOwner(session, ownerOverride);

    try {
      const pulls = await session.octokit.paginate(session.octokit.pulls.list, {
        owner,
        repo,
        per_page: 100,
        sort: 'updated',
        direction: 'desc',
        state: 'all',
      });

      return pulls.map((pull) => toPullSummary(pull));
    } catch (err) {
      this.githubSession.handleGithubError(err);
    }
  }
}
