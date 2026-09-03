import type { GithubSessionSource } from '../shared/github-session.provider';
import { GetPullHeadShaDto } from './get-pull-head-sha.dto';

export class GetPullHeadShaUseCase {
  constructor(private readonly githubSession: GithubSessionSource) {}

  async execute({
    repo,
    pullNumber,
    currentUser,
    ownerOverride,
  }: GetPullHeadShaDto): Promise<string> {
    const session = await this.githubSession.getSession(currentUser);
    const owner = this.githubSession.resolveOwner(session, ownerOverride);

    try {
      const { data } = await session.octokit.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
      });
      return data.head.sha;
    } catch (err) {
      this.githubSession.handleGithubError(err);
    }
  }
}
