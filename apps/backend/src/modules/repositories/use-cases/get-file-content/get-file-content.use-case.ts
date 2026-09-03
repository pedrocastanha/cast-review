import type { GithubSessionSource } from '../shared/github-session.provider';
import { GetFileContentDto } from './get-file-content.dto';

export class GetFileContentUseCase {
  constructor(private readonly githubSession: GithubSessionSource) {}

  async execute({
    repo,
    path,
    ref,
    currentUser,
    ownerOverride,
  }: GetFileContentDto): Promise<string | null> {
    const session = await this.githubSession.getSession(currentUser);
    const owner = this.githubSession.resolveOwner(session, ownerOverride);

    try {
      const { data } = await session.octokit.repos.getContent({
        owner,
        repo,
        path,
        ref,
      });

      if (Array.isArray(data) || data.type !== 'file' || !data.content) {
        return null;
      }

      return Buffer.from(data.content, 'base64').toString('utf-8');
    } catch (err) {
      if ((err as { status?: number }).status === 404) {
        return null;
      }
      this.githubSession.handleGithubError(err);
    }
  }
}
