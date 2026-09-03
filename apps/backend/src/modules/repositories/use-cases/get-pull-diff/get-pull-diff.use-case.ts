import type { GithubSessionSource } from '../shared/github-session.provider';
import { GetPullDiffDto } from './get-pull-diff.dto';

export class GetPullDiffUseCase {
  constructor(private readonly githubSession: GithubSessionSource) {}

  async execute({
    repo,
    pullNumber,
    currentUser,
    ownerOverride,
  }: GetPullDiffDto): Promise<string> {
    const session = await this.githubSession.getSession(currentUser);
    const owner = this.githubSession.resolveOwner(session, ownerOverride);

    try {
      const { data } = await session.octokit.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
        mediaType: { format: 'diff' },
      });

      return data as unknown as string;
    } catch (err) {
      this.githubSession.handleGithubError(err);
    }
  }
}
