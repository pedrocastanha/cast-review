import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AppLogger } from 'src/shared/logger/logger.service';
import { BaseService } from 'src/shared/services/base.service';
import { CreateUserDto } from './dtos/create-user.dto';
import { User } from './user.entity';
import { UserRepository } from './user.repository';
import { UpdateUserDto } from './dtos/update-user.dto';
import { Octokit } from '@octokit/rest';

@Injectable()
export class UserService extends BaseService {
  constructor(
    private readonly userRepository: UserRepository,
    logger: AppLogger,
  ) {
    super(logger);
  }

  async createUser(dto: CreateUserDto): Promise<User> {
    return await this.safeExecute(async () => {
      const user = this.userRepository.create({
        ...dto,
        password: await bcrypt.hash(dto.password, 12),
      });
      await this.userRepository.save(user);

      delete (user as Partial<User>).password;

      return user;
    });
  }

  async updateUser(id: string, dto: UpdateUserDto){
    if(dto.githubToken !== null){
        const token = dto.githubToken?.trim();
        if (!token) {
          throw new BadRequestException('Token is required');
        }

        const octokit = new Octokit({ auth: token });

        try {
          const { data } = await octokit.users.getAuthenticated();

          return {
            login: data.login,
            id: data.id,
            name: data.name,
            avatarUrl: data.avatar_url,
          };
        } catch {
          throw new UnauthorizedException('Token do Github expirado ou inválido.');
        }
    }

    return this.userRepository.update(id, {...dto})
  }

  async getById(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  async getByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email }
    });
  }

  async getByUsername(username: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { username }
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
}
