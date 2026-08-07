import {
  BadRequestException,
  ForbiddenException,
  Injectable,
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

const OWNER_CACHE_TTL_MS = 5 * 60_000;

@Injectable()
export class RepositoriesService extends BaseService {
  private readonly ownerCache = new Map<
    string,
    { owner: string; expiresAt: number }
  >();

  constructor(
    private readonly userService: UserService,
    logger: AppLogger,
  ) {
    super(logger);
  }

  private async session(currentUser: CurrentUserData): Promise<GithubSession> {
    const token = await this.userService.getGithubToken(currentUser.id);

    if (!token?.trim()) {
      throw new BadRequestException(
        'Você precisa configurar o token do Github primeiro',
      );
    }

    const octokit = new Octokit({ auth: token });
    const owner = await this.resolveOwner(octokit, currentUser.id);

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
          affiliation: 'owner',
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

  async listPulls(repo: string, currentUser: CurrentUserData) {
    const { octokit, owner } = await this.session(currentUser);

    try {
      const pulls = await octokit.paginate(octokit.pulls.list, {
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
  ) {
    const { octokit, owner } = await this.session(currentUser);

    try {
      const { data } = await octokit.pulls.get({
        owner,
        repo,
        pull_number: pullNumber,
      });

      return this.toPullSummary(data);
    } catch (err) {
      this.handleGithubError(err);
    }
  }

  private async resolveOwner(
    octokit: Octokit,
    userId: string,
  ): Promise<string> {
    const cached = this.ownerCache.get(userId);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.owner;
    }

    try {
      const { data } = await octokit.users.getAuthenticated();

      this.ownerCache.set(userId, {
        owner: data.login,
        expiresAt: Date.now() + OWNER_CACHE_TTL_MS,
      });

      return data.login;
    } catch (err) {
      this.ownerCache.delete(userId);
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

    throw err;
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
