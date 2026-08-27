import { GithubSessionProvider } from '../shared/github-session.provider';
import { GithubPullFile } from '../../types/github-pull.type';
import { ListPullFilesDto } from './list-pull-files.dto';

export class ListPullFilesUseCase {
  constructor(private readonly githubSession: GithubSessionProvider) {}

  async execute({
    repo,
    pullNumber,
    currentUser,
    ownerOverride,
  }: ListPullFilesDto): Promise<GithubPullFile[]> {
    const session = await this.githubSession.getSession(currentUser);
    const owner = this.githubSession.resolveOwner(session, ownerOverride);

    try {
      const files = await session.octokit.paginate(
        session.octokit.pulls.listFiles,
        { owner, repo, pull_number: pullNumber, per_page: 100 },
      );

      return files.map((file) => ({
        filename: file.filename,
        status: file.status,
        patch: file.patch,
      }));
    } catch (err) {
      this.githubSession.handleGithubError(err);
    }
  }
}
