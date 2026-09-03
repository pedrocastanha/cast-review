import type { GithubSessionSource } from '../shared/github-session.provider';
import { ListReposDto } from './list-repos.dto';

const REPO_AFFILIATION = 'owner,collaborator,organization_member';

export class ListReposUseCase {
  constructor(private readonly githubSession: GithubSessionSource) {}

  async execute({ currentUser }: ListReposDto) {
    const { octokit } = await this.githubSession.getSession(currentUser);

    try {
      const repos = await octokit.paginate(
        octokit.repos.listForAuthenticatedUser,
        {
          per_page: 100,
          sort: 'updated',
          affiliation: REPO_AFFILIATION,
        },
      );

      return repos.map((repo) => ({
        id: repo.id,
        name: repo.name,
        fullName: repo.full_name,
        owner: repo.owner.login,
        private: repo.private,
        description: repo.description,
        htmlUrl: repo.html_url,
        updatedAt: repo.updated_at,
        defaultBranch: repo.default_branch,
      }));
    } catch (err) {
      this.githubSession.handleGithubError(err);
    }
  }
}
