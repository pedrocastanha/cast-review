import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import { AppLogger } from 'src/shared/logger/logger.service';
import type { CurrentUserData } from '../../../auth/utils/current-user-decorator';
import { UserService } from '../../../users/user.service';
import { GithubSession } from '../../types/github-session.type';

export class GithubSessionProvider {
  constructor(
    private readonly userService: UserService,
    private readonly logger: AppLogger,
  ) {}

  async getSession(currentUser: CurrentUserData): Promise<GithubSession> {
    const { token, login } = await this.userService.getGithubCredentials(
      currentUser.id,
    );

    const octokit = new Octokit({ auth: token });
    const owner = login ?? (await this.backfillLogin(octokit, currentUser.id));

    return { octokit, owner };
  }

  resolveOwner(session: GithubSession, ownerOverride?: string): string {
    return ownerOverride?.trim() || session.owner;
  }

  async resolveDefaultBranchSha(
    octokit: Octokit,
    owner: string,
    repo: string,
  ): Promise<string> {
    const { data: repoData } = await octokit.repos.get({ owner, repo });
    const { data: ref } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${repoData.default_branch}`,
    });
    return ref.object.sha;
  }

  handleGithubError(err: unknown): never {
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
}
