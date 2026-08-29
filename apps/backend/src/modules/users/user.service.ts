import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Octokit } from '@octokit/rest';
import * as bcrypt from 'bcrypt';
import { SecretDecryptionError } from 'src/shared/crypto/secret-crypto';
import { AppLogger } from 'src/shared/logger/logger.service';
import { BaseService } from 'src/shared/services/base.service';
import { CreateUserDto } from './dtos/create-user.dto';
import { UpdateUserDto } from './dtos/update-user.dto';
import { toUserResponse, UserResponseDto } from './dtos/user-response.dto';
import { User } from './user.entity';
import { UserRepository } from './user.repository';
import { GithubCredentials } from './types/github-credentials.type';

const REQUIRED_CLASSIC_SCOPES = ['repo', 'public_repo'];

@Injectable()
export class UserService extends BaseService {
  constructor(
    private readonly userRepository: UserRepository,
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

    if (openaiKey !== undefined) {
      const key = openaiKey.trim();

      if (!key) {
        throw new BadRequestException('Chave da OpenAI é obrigatória');
      }

      patch.openaiKey = key;
      patch.openaiKeyLastFour = key.slice(-4);
    }

    if (githubToken !== undefined) {
      const token = githubToken.trim();

      if (!token) {
        throw new BadRequestException('Token do Github é obrigatório');
      }

      patch.githubToken = token;
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

    return this.getByIdOrFail(id);
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
    let user: User | null;

    try {
      user = await this.userRepository.findOne({
        where: { id },
        select: { id: true, githubToken: true, githubLogin: true },
      });
    } catch (err) {
      if (err instanceof SecretDecryptionError) {
        this.logger.error('Falha ao decifrar o token do Github', {
          exception: err,
          userId: id,
        });

        throw new BadRequestException(
          'Token do Github ilegível. Reconfigure o seu token.',
        );
      }

      throw err;
    }

    if (!user?.githubToken?.trim()) {
      throw new BadRequestException(
        'Você precisa configurar o token do Github primeiro',
      );
    }

    return { token: user.githubToken, login: user.githubLogin };
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
    let user: User | null;

    try {
      user = await this.userRepository.findOne({
        where: { id },
        select: { id: true, openaiKey: true },
      });
    } catch (err) {
      if (err instanceof SecretDecryptionError) {
        this.logger.error('Falha ao decifrar a chave da OpenAI', {
          exception: err,
          userId: id,
        });

        throw new BadRequestException(
          'Chave da OpenAI ilegível. Reconfigure a chave em Configurações.',
        );
      }

      throw err;
    }

    if (!user?.openaiKey?.trim()) {
      throw new BadRequestException(
        'Configure sua chave da OpenAI em Configurações antes de usar a IA.',
      );
    }

    return user.openaiKey;
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
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    return toUserResponse(user);
  }

  async getByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        active: true,
        password: true,
      },
    });
  }

  async getByUsername(username: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { username },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        active: true,
        password: true,
      },
    });
  }

  async getByIdAndRefresh(id: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        username: true,
        active: true,
        currentRefreshToken: true,
      },
    });
  }

  async updateRefresh(
    userId: string,
    hashedRefreshToken: string | null,
  ): Promise<void> {
    await this.safeExecute(async () => {
      await this.userRepository.update(userId, {
        currentRefreshToken: hashedRefreshToken,
      });
    });
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
