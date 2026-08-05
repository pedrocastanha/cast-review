import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { Octokit } from '@octokit/rest';

@Injectable()
export class GithubService {
  private client(token: string): Octokit {
    if (!token?.trim()) {
      throw new BadRequestException('GitHub token is required');
    }
    return new Octokit({ auth: token.trim() });
  }

  async listRepos(token: string) {
    const octokit = this.client(token);
    try {
      const repos = await octokit.paginate(
        octokit.repos.listForAuthenticatedUser,
        {
          per_page: 100,
          sort: 'updated',
          affiliation: 'owner,collaborator,organization_member',
        },
      );

      return repos.map((r) => ({
        id: r.id,
        name: r.name,
        fullName: r.full_name,
        owner: r.owner.login,
        private: r.private,
        description: r.description,
        htmlUrl: r.html_url,
        updatedAt: r.updated_at,
        defaultBranch: r.default_branch,
      }));
    } catch (err) {
      this.rethrowGitHub(err);
    }
  }

  /**
   * Lista PRs abertas (e opcionalmente closed) de um repositório.
   */
  async listPullRequests(
    token: string,
    owner: string,
    repo: string,
    state: 'open' | 'closed' | 'all' = 'open',
  ) {
    const octokit = this.client(token);
    try {
      const pulls = await octokit.paginate(octokit.pulls.list, {
        owner,
        repo,
        state,
        per_page: 50,
        sort: 'updated',
        direction: 'desc',
      });

      return pulls.map((p) => ({
        id: p.id,
        number: p.number,
        title: p.title,
        state: p.state,
        user: p.user?.login ?? null,
        createdAt: p.created_at,
        updatedAt: p.updated_at,
        htmlUrl: p.html_url,
        draft: p.draft ?? false,
        headRef: p.head.ref,
        baseRef: p.base.ref,
      }));
    } catch (err) {
      this.rethrowGitHub(err);
    }
  }

  /**
   * Diff unificado da PR (media type diff do GitHub).
   *
   * É o mesmo formato que `git diff` — o Python parseia com regex
   * e/ou usa os paths de changedFiles.
   */
  async getPullRequestDiff(
    token: string,
    owner: string,
    repo: string,
    pullNumber: number,
  ): Promise<string> {
    const octokit = this.client(token);
    try {
      const { data } = await octokit.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
        mediaType: { format: 'diff' },
      });
      // Com mediaType diff o Octokit devolve string em data.
      return typeof data === 'string' ? data : String(data);
    } catch (err) {
      this.rethrowGitHub(err);
    }
  }

  /**
   * Metadados + lista de arquivos da PR (com patch por arquivo quando disponível).
   *
   * O campo ``patch`` nem sempre vem (binários / files grandes).
   * Nesses casos o Context Builder usa fullContent + diff agregado.
   */
  async getPullRequestFiles(
    token: string,
    owner: string,
    repo: string,
    pullNumber: number,
  ) {
    const octokit = this.client(token);
    try {
      const files = await octokit.paginate(octokit.pulls.listFiles, {
        owner,
        repo,
        pull_number: pullNumber,
        per_page: 100,
      });

      return files.map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
        changes: f.changes,
        patch: f.patch ?? '',
        sha: f.sha,
        blobUrl: f.blob_url,
      }));
    } catch (err) {
      this.rethrowGitHub(err);
    }
  }

  /**
   * Conteúdo de um arquivo em um ref (branch, tag ou SHA de commit).
   *
   * Usado pelo Context Builder para fullContent e relatedFiles.
   * Arquivos binários / >1MB são cortados com placeholder.
   */
  async getFileContent(
    token: string,
    owner: string,
    repo: string,
    path: string,
    ref: string,
  ): Promise<string> {
    const octokit = this.client(token);
    try {
      const { data } = await octokit.repos.getContent({
        owner,
        repo,
        path,
        ref,
      });

      // getContent pode devolver array (diretório) — não queremos isso.
      if (Array.isArray(data) || data.type !== 'file' || !('content' in data)) {
        return `/* ${path} is not a file or has no content */`;
      }

      // GitHub manda base64; arquivos grandes usam encoding none + download_url.
      if (data.encoding === 'base64' && data.content) {
        const buff = Buffer.from(data.content.replace(/\n/g, ''), 'base64');
        // Limite defensivo de ~400KB de texto por arquivo no MVP.
        if (buff.length > 400_000) {
          return `/* file too large truncated: ${path} (${buff.length} bytes) */\n${buff
            .subarray(0, 400_000)
            .toString('utf-8')}`;
        }
        return buff.toString('utf-8');
      }

      return `/* unable to decode content for ${path} */`;
    } catch (err: unknown) {
      // 404: arquivo removido no head ou path inválido — devolve vazio anotado.
      const status = (err as { status?: number })?.status;
      if (status === 404) {
        return `/* file not found at ref: ${path} @ ${ref} */`;
      }
      this.rethrowGitHub(err);
    }
  }

  /**
   * Lê conventions.md na raiz do repo (ou .cast/conventions.md).
   *
   * Se não existir, devolve string vazia — o Architecture Reviewer
   * trata isso com pass informativo (regra 3).
   */
  async getConventions(
    token: string,
    owner: string,
    repo: string,
    ref: string,
  ): Promise<string> {
    const candidates = ['conventions.md', 'CONVENTIONS.md', '.cast/conventions.md'];
    for (const path of candidates) {
      const content = await this.getFileContent(token, owner, repo, path, ref);
      if (!content.startsWith('/* file not found')) {
        return content;
      }
    }
    return '';
  }

  /**
   * Detalhes da PR (head.sha é o ref certo para ler arquivos do branch da PR).
   */
  async getPullRequest(
    token: string,
    owner: string,
    repo: string,
    pullNumber: number,
  ) {
    const octokit = this.client(token);
    try {
      const { data } = await octokit.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
      });
      return {
        number: data.number,
        title: data.title,
        state: data.state,
        headSha: data.head.sha,
        headRef: data.head.ref,
        baseSha: data.base.sha,
        baseRef: data.base.ref,
        user: data.user?.login ?? null,
      };
    } catch (err) {
      this.rethrowGitHub(err);
    }
  }

  /**
   * Normaliza erros do Octokit em HTTP exceptions do Nest.
   * `never` no retorno diz ao TS que a função sempre lança.
   */
  private rethrowGitHub(err: unknown): never {
    const status = (err as { status?: number })?.status;
    if (status === 401 || status === 403) {
      throw new UnauthorizedException('GitHub authentication failed');
    }
    if (status === 404) {
      throw new NotFoundException('GitHub resource not found');
    }
    throw new BadRequestException(
      `GitHub API error${status ? ` (${status})` : ''}`,
    );
  }
}
