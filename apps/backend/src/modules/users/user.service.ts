import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AppLogger } from 'src/shared/logger/logger.service';
import { BaseService } from 'src/shared/services/base.service';
import { CreateUserDto } from './dtos/create-user.dto';
import { User } from './user.entity';
import { UserRepository } from './user.repository';

const BCRYPT_ROUNDS = 12;

const CREDENTIALS_SELECT = {
  id: true,
  name: true,
  email: true,
  username: true,
  password: true,
  active: true,
} as const;

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
        password: await bcrypt.hash(dto.password, BCRYPT_ROUNDS),
      });
      await this.userRepository.save(user);

      delete (user as Partial<User>).password;

      return user;
    });
  }

  async updateUser(id: string, dto: UpdateUserDto){
    return this.userRepository.update(id, ..dto)
  }

  async getById(id: string): Promise<User | null> {
    return this.userRepository.findOne({ where: { id } });
  }

  async getByEmail(email: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { email },
      select: CREDENTIALS_SELECT,
    });
  }

  async getByUsername(username: string): Promise<User | null> {
    return this.userRepository.findOne({
      where: { username },
      select: CREDENTIALS_SELECT,
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
