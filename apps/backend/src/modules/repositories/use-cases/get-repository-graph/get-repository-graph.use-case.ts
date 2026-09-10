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
    const session = await this.githubSession.getSession(currentUser);
    const owner = this.githubSession.resolveOwner(session, ownerOverride);

    // `owner` e `repo` vêm do cliente e o ai-api não autoriza nada: sem esta
    // checagem, `?owner=` lê o grafo de qualquer repositório indexado.
    await this.githubSession.assertRepositoryAccess(session, owner, repo);

    const repoId = `${owner}/${repo}`;

    const resolvedSha =
      sha ??
      (await this.aiApiClient.getIndexStatus(repoId, currentUser.id)).sha;
    if (!resolvedSha) {
      return { nodes: [], edges: [], stats: { indexed: false } };
    }

    return this.aiApiClient.getGraph(
      repoId,
      resolvedSha,
      currentUser.id,
      focus,
      depth,
    );
  }
}
