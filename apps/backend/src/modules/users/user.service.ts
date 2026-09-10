import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import * as bcrypt from 'bcrypt';
import {
  decryptBoundSecret,
  encryptBoundSecret,
  isBoundToOwner,
  SecretDecryptionError,
} from 'src/shared/crypto/secret-crypto';
import { AppLogger } from 'src/shared/logger/logger.service';
import { demoSessionTtlMinutes } from 'src/shared/security/demo-access';
import {
  currentRequestCredentials,
  isEphemeralMode,
} from 'src/shared/security/request-credentials';
import { BaseService } from 'src/shared/services/base.service';
import { RefreshSessionRepository } from '../auth/refresh-session.repository';
import { CreateUserDto } from './dtos/create-user.dto';
import { UpdateUserDto } from './dtos/update-user.dto';
import { toUserResponse, UserResponseDto } from './dtos/user-response.dto';
import { GithubCredentials } from './types/github-credentials.type';
import { User } from './user.entity';
import { UserRepository } from './user.repository';

const REQUIRED_CLASSIC_SCOPES = ['repo', 'public_repo'];
const GITHUB_TOKEN_FIELD = 'github_token';
const OPENAI_KEY_FIELD = 'openai_key';

@Injectable()
export class UserService extends BaseService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly refreshSessions: RefreshSessionRepository,
    logger: AppLogger,
  ) {
    super(logger);
  }

  async createUser(dto: CreateUserDto): Promise<UserResponseDto> {
    return await this.safeExecute(async () => {
      const user = this.userRepository.create({
        ...dto,
        password: await bcrypt.hash(dto.password, 12),
      });
      await this.userRepository.save(user);

      return toUserResponse(user);
    });
  }

  async updateUser(id: string, dto: UpdateUserDto): Promise<UserResponseDto> {
    const { githubToken, openaiKey, ...rest } = dto;
    const patch: Partial<User> = { ...rest };

    if (openaiKey !== undefined || githubToken !== undefined) {
      if (isEphemeralMode()) {
        throw new BadRequestException(
          'Esta instância não guarda credenciais. Use a sessão sem salvar nada.',
        );
      }

      if (await this.isGuest(id)) {
        throw new BadRequestException(
          'Contas de teste não guardam credenciais. Use a sessão sem salvar nada.',
        );
      }
    }

    if (openaiKey !== undefined) {
      const key = openaiKey.trim();

      if (!key) {
        throw new BadRequestException('Chave da OpenAI é obrigatória');
      }

      patch.openaiKey = encryptBoundSecret(key, {
        ownerId: id,
        field: OPENAI_KEY_FIELD,
      });
      patch.openaiKeyLastFour = key.slice(-4);
    }

    if (githubToken !== undefined) {
      const token = githubToken.trim();

      if (!token) {
        throw new BadRequestException('Token do Github é obrigatório');
      }

      patch.githubToken = encryptBoundSecret(token, {
        ownerId: id,
        field: GITHUB_TOKEN_FIELD,
      });
      patch.githubTokenLastFour = token.slice(-4);
      patch.githubLogin = await this.validateGithubToken(token);
    }

    if (Object.keys(patch).length === 0) {
      return this.getByIdOrFail(id);
    }

    const result = await this.safeExecute(() =>
      this.userRepository.update(id, patch),
    );

    if (!result.affected) {
      throw new NotFoundException('Usuário não encontrado');
    }

    if (rest.email !== undefined || rest.username !== undefined) {
      await this.refreshSessions.revokeAllForUser(id, 'credentials_changed');
    }

    return this.getByIdOrFail(id);
  }

  async isGuest(id: string): Promise<boolean> {
    const user = await this.userRepository.findOne({
      where: { id },
      select: { id: true, demoExpiresAt: true },
    });

    return Boolean(user?.demoExpiresAt);
  }

  async createGuestUser(): Promise<User> {
    const id = randomUUID();
    const expiresAt = new Date(
      demoSessionTtlMinutes() * 60 * 1000 + Date.now(),
    );
    const user = this.userRepository.create({
      id,
      name: 'Visitante',
      email: `guest-${id}@demo.invalid`,
      username: null,
      password: await bcrypt.hash(randomUUID() + randomUUID(), 12),
      demoExpiresAt: expiresAt,
    });

    await this.userRepository.save(user);

    return user;
  }

  /**
   * Expurgo de contas demo. Não tem dono humano, então roda como ator `job`,
   * coberto pelas policies `users_demo_reaper` e `analyses_demo_reaper` — que
   * só alcançam linhas cujo usuário tem `demo_expires_at` preenchido.
   *
   * Tudo numa transação só: apagar as análises e não apagar os usuários
   * deixaria o expurgo pela metade.
   */
  async purgeExpiredGuests(limit = 50): Promise<number> {
    return this.userRepository.withRlsTransaction(
      async (manager) => {
        const expired = (await manager.query(
          `SELECT id FROM users WHERE demo_expires_at IS NOT NULL AND demo_expires_at < now() LIMIT $1`,
          [limit],
        )) as Array<{ id: string }>;

        if (!expired.length) return 0;

        const ids = expired.map((row) => row.id);
        await manager.query(
          `DELETE FROM analyses WHERE requested_by = ANY($1::uuid[])`,
          [ids],
        );
        await manager.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [
          ids,
        ]);

        return ids.length;
      },
      { actorType: 'job', userId: null },
    );
  }

  async removeGithubToken(id: string): Promise<UserResponseDto> {
    const result = await this.safeExecute(() =>
      this.userRepository.update(id, {
        githubToken: null,
        githubTokenLastFour: null,
        githubLogin: null,
      }),
    );

    if (!result.affected) {
      throw new NotFoundException('Usuário não encontrado');
    }

    return this.getByIdOrFail(id);
  }

  async getGithubCredentials(id: string): Promise<GithubCredentials> {
    const supplied = currentRequestCredentials().githubToken;
    if (supplied) {
      const user = await this.userRepository.findOne({
        where: { id },
        select: { id: true, githubLogin: true },
      });
      return { token: supplied, login: user?.githubLogin ?? null };
    }

    if (isEphemeralMode()) {
      throw new BadRequestException(
        'Informe o token do Github nesta sessão para continuar',
      );
    }

    const user = await this.userRepository.findOne({
      where: { id },
      select: { id: true, githubToken: true, githubLogin: true },
    });

    if (!user?.githubToken?.trim()) {
      throw new BadRequestException(
        'Você precisa configurar o token do Github primeiro',
      );
    }

    const token = await this.readBoundSecret(
      id,
      user.githubToken,
      GITHUB_TOKEN_FIELD,
      'Token do Github ilegível. Reconfigure o seu token.',
    );

    return { token, login: user.githubLogin };
  }

  async removeOpenaiKey(id: string): Promise<UserResponseDto> {
    const result = await this.safeExecute(() =>
      this.userRepository.update(id, {
        openaiKey: null,
        openaiKeyLastFour: null,
      }),
    );

    if (!result.affected) {
      throw new NotFoundException('Usuário não encontrado');
    }

    return this.getByIdOrFail(id);
  }

  async getOpenaiKey(id: string): Promise<string> {
    const supplied = currentRequestCredentials().openaiKey;
    if (supplied) return supplied;

    if (isEphemeralMode()) {
      throw new BadRequestException(
        'Informe a chave da OpenAI nesta sessão para continuar',
      );
    }

    const user = await this.userRepository.findOne({
      where: { id },
      select: { id: true, openaiKey: true },
    });

    if (!user?.openaiKey?.trim()) {
      throw new BadRequestException(
        'Configure sua chave da OpenAI em Configurações antes de usar a IA.',
      );
    }

    return this.readBoundSecret(
      id,
      user.openaiKey,
      OPENAI_KEY_FIELD,
      'Chave da OpenAI ilegível. Reconfigure a chave em Configurações.',
    );
  }

  private async readBoundSecret(
    id: string,
    stored: string,
    field: string,
    failureMessage: string,
  ): Promise<string> {
    let plain: string;

    try {
      plain = decryptBoundSecret(stored, { ownerId: id, field });
    } catch (err) {
      if (err instanceof SecretDecryptionError) {
        this.logger.error('Falha ao decifrar segredo do usuário', {
          exception: err,
          userId: id,
          field,
        });

        throw new BadRequestException(failureMessage);
      }

      throw err;
    }

    if (!isBoundToOwner(stored)) {
      await this.rebindSecret(id, stored, plain, field);
    }

    return plain;
  }

  private async rebindSecret(
    id: string,
    stored: string,
    plain: string,
    field: string,
  ): Promise<void> {
    try {
      await this.userRepository.withRlsTransaction((manager) =>
        this.userRepository
          .createQueryBuilder(undefined, manager)
          .update(User)
          .set({
            [field === GITHUB_TOKEN_FIELD ? 'githubToken' : 'openaiKey']:
              encryptBoundSecret(plain, { ownerId: id, field }),
          })
          .where('id = :id AND ' + field + ' = :stored', { id, stored })
          .execute(),
      );
    } catch (err) {
      this.logger.error('Falha ao religar segredo ao dono', {
        exception: err,
        userId: id,
        field,
      });
    }
  }

  async setGithubLogin(id: string, login: string): Promise<void> {
    await this.safeExecute(() =>
      this.userRepository.update(id, { githubLogin: login }),
    );
  }

  async getById(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  async getByIdOrFail(id: string): Promise<UserResponseDto> {
    const user = await this.userRepository.findOne({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        active: true,
        githubLogin: true,
        githubTokenLastFour: true,
        openaiKeyLastFour: true,
        demoExpiresAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    return toUserResponse(user);
  }

  /**
   * Login por e-mail devolve, por definição, a linha de alguém que ainda não se
   * autenticou — não há `app.user_id` para escopar. Roda sob a policy
   * `users_auth_bootstrap`, que é SELECT apenas.
   */
  async getByEmail(email: string): Promise<User | null> {
    return this.authLookup({ email });
  }

  async getByUsername(username: string): Promise<User | null> {
    return this.authLookup({ username });
  }

  private async authLookup(
    where: { email: string } | { username: string },
  ): Promise<User | null> {
    return this.userRepository.withRlsTransaction(
      (manager) =>
        this.userRepository.findOne(
          {
            where,
            select: {
              id: true,
              name: true,
              email: true,
              username: true,
              active: true,
              password: true,
            },
          },
          manager,
        ),
      { actorType: 'auth', userId: null },
    );
  }

  private async validateGithubToken(token: string): Promise<string> {
    const octokit = new Octokit({ auth: token });

    let login: string;
    let scopesHeader: string | undefined;

    try {
      const { data, headers } = await octokit.users.getAuthenticated();
      login = data.login;
      scopesHeader = headers['x-oauth-scopes'];
    } catch (err) {
      this.logger.warn('Token do Github recusado na validação', {
        exception: err,
      });

      throw new UnauthorizedException('Token do Github expirado ou inválido.');
    }

    if (scopesHeader !== undefined) {
      const scopes = scopesHeader
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean);

      if (!scopes.some((scope) => REQUIRED_CLASSIC_SCOPES.includes(scope))) {
        throw new BadRequestException(
          'O token do Github precisa do escopo "repo" (ou "public_repo").',
        );
      }

      return login;
    }

    try {
      await octokit.repos.listForAuthenticatedUser({ per_page: 1 });
    } catch (err) {
      const status = (err as { status?: number }).status;

      if (status === 403 || status === 401) {
        throw new BadRequestException(
          'O token do Github não tem permissão de leitura em repositórios.',
        );
      }

      throw err;
    }

    return login;
  }
}
