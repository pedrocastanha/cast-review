import { AiApiClient } from 'src/shared/clients/ai/ai-api.client';
import type { GithubSessionSource } from '../shared/github-session.provider';
import { GetRepositoryGraphDto } from './get-repository-graph.dto';

export class GetRepositoryGraphUseCase {
  constructor(
    private readonly githubSession: GithubSessionSource,
    private readonly aiApiClient: AiApiClient,
  ) {}

  async execute({
    repo,
    currentUser,
    ownerOverride,
    sha,
    focus,
    depth,
  }: GetRepositoryGraphDto) {
    const owner =
      ownerOverride?.trim() ||
      (await this.githubSession.getSession(currentUser)).owner;
    const repoId = `${owner}/${repo}`;

    const resolvedSha =
      sha ?? (await this.aiApiClient.getIndexStatus(repoId)).sha;
    if (!resolvedSha) {
      return { nodes: [], edges: [], stats: { indexed: false } };
    }

    return this.aiApiClient.getGraph(repoId, resolvedSha, focus, depth);
  }
}
