import {
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { AppLogger } from 'src/shared/logger/logger.service';
import { BaseService } from 'src/shared/services/base.service';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';
import { UserService } from '../users/user.service';

type GithubPull = {
  id: number;
  number: number;
  title: string;
  state: string;
  user: { login: string } | null;
  created_at: string;
  updated_at: string;
  html_url: string;
  draft?: boolean;
  head: { ref: string };
  base: { ref: string };
};

type GithubSession = {
  octokit: Octokit;
  owner: string;
};

type GithubPullFile = {
  filename: string;
  status: string;
  patch?: string;
};

const REPO_AFFILIATION = 'owner,collaborator,organization_member';

@Injectable()
export class RepositoriesService extends BaseService {
  constructor(
    private readonly userService: UserService,
    logger: AppLogger,
  ) {
    super(logger);
  }

  private async session(currentUser: CurrentUserData): Promise<GithubSession> {
    const { token, login } = await this.userService.getGithubCredentials(
      currentUser.id,
    );

    const octokit = new Octokit({ auth: token });
    const owner = login ?? (await this.backfillLogin(octokit, currentUser.id));

    return { octokit, owner };
  }

  async listRepos(currentUser: CurrentUserData) {
    const { octokit } = await this.session(currentUser);

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
      this.handleGithubError(err);
    }
  }

  async listPulls(
    repo: string,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ) {
    const session = await this.session(currentUser);
    const owner = ownerOverride?.trim() || session.owner;

    try {
      const pulls = await session.octokit.paginate(session.octokit.pulls.list, {
        owner,
        repo,
        per_page: 100,
        sort: 'updated',
        direction: 'desc',
        state: 'all',
      });

      return pulls.map((pull) => this.toPullSummary(pull));
    } catch (err) {
      this.handleGithubError(err);
    }
  }

  async getPullByNumber(
    repo: string,
    pullNumber: number,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ) {
    const session = await this.session(currentUser);
    const owner = ownerOverride?.trim() || session.owner;

    try {
      const { data } = await session.octokit.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
      });

      return this.toPullSummary(data);
    } catch (err) {
      this.handleGithubError(err);
    }
  }

  /** Diff bruto da PR (patch unificado), usado como contexto pro Change Analyzer. */
  async getPullDiff(
    repo: string,
    pullNumber: number,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<string> {
    const session = await this.session(currentUser);
    const owner = ownerOverride?.trim() || session.owner;

    try {
      const { data } = await session.octokit.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
        mediaType: { format: 'diff' },
      });

      return data as unknown as string;
    } catch (err) {
      this.handleGithubError(err);
    }
  }

  /** Arquivos alterados na PR (path + patch por arquivo), base do Context Builder. */
  async listPullFiles(
    repo: string,
    pullNumber: number,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<GithubPullFile[]> {
    const session = await this.session(currentUser);
    const owner = ownerOverride?.trim() || session.owner;

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
      this.handleGithubError(err);
    }
  }

  /**
   * Conteúdo completo de um arquivo numa ref (branch/sha) específica.
   * Devolve `null` em vez de lançar quando o arquivo não existe na ref
   * (path advinhado pela heurística de imports errou, ou arquivo foi deletado).
   */
  async getFileContent(
    repo: string,
    path: string,
    ref: string,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<string | null> {
    const session = await this.session(currentUser);
    const owner = ownerOverride?.trim() || session.owner;

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
      this.handleGithubError(err);
    }
  }

  /** `conventions.md` na raiz do repo, na ref da PR. String vazia se não existir. */
  async getConventions(
    repo: string,
    ref: string,
    currentUser: CurrentUserData,
    ownerOverride?: string,
  ): Promise<string> {
    const content = await this.getFileContent(
      repo,
      'conventions.md',
      ref,
      currentUser,
      ownerOverride,
    );

    return content ?? '';
  }

  private async backfillLogin(
    octokit: Octokit,
    userId: string,
  ): Promise<string> {
    try {
      const { data } = await octokit.users.getAuthenticated();
      await this.userService.setGithubLogin(userId, data.login);

      return data.login;
    } catch (err) {
      this.handleGithubError(err);
    }
  }

  private handleGithubError(err: unknown): never {
    this.logger.error('Falha na chamada à API do Github', { exception: err });

    const status = (err as { status?: number }).status;

    if (status === 401) {
      throw new UnauthorizedException('Token do Github expirado ou inválido.');
    }

    if (status === 403 || status === 429) {
      throw new ForbiddenException(
        'Acesso negado pelo Github: permissão insuficiente ou limite de requisições atingido.',
      );
    }

    if (status === 404) {
      throw new NotFoundException('Recurso não encontrado no Github');
    }

    throw new InternalServerErrorException(
      'Erro inesperado ao consultar a API do Github',
    );
  }

  private toPullSummary(pull: GithubPull) {
    return {
      id: pull.id,
      number: pull.number,
      title: pull.title,
      state: pull.state,
      user: pull.user?.login ?? null,
      createdAt: pull.created_at,
      updatedAt: pull.updated_at,
      htmlUrl: pull.html_url,
      draft: pull.draft ?? false,
      headRef: pull.head.ref,
      baseRef: pull.base.ref,
    };
  }
}
