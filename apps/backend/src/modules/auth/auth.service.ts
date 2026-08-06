import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { CreateUserDto } from '../users/dtos/create-user.dto';
import { User } from '../users/user.entity';
import { UserService } from '../users/user.service';
import { jwtConfig } from './auth.config';
import { LoginDto } from './dtos/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  async validateUserByEmail(email: string): Promise<User | null> {
    return this.userService.getByEmail(email);
  }

  async register(dto: CreateUserDto) {
    return this.userService.createUser(dto);
  }

  async login({ email, username, password }: LoginDto) {
    if (!email && !username) {
      throw new UnauthorizedException('E-mail ou senha inválidos');
    }

    const user = email
      ? await this.validateUserByEmail(email)
      : await this.userService.getByUsername(username ?? '');

    if (!user) throw new UnauthorizedException('E-mail ou senha inválidos');

    if (!user.password) {
      throw new UnauthorizedException(
        'Esta conta ainda não possui senha definida.',
      );
    }

    const isPasswordValid = await this.comparePassword(password, user.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('E-mail ou senha inválidos');
    }

    if (!user.active) throw new UnauthorizedException('Usuário inativo');

    const accessToken = await this.generateAccessToken(user);
    const refreshToken = await this.generateRefreshToken(user);

    await this.setCurrentRefreshToken(refreshToken, user.id);

    return {
      accessToken,
      refreshToken,
    };
  }

  async getNewTokens(userId: string) {
    const user = await this.userService.getById(userId);
    if (!user) throw new UnauthorizedException('Usuário não encontrado');
    if (!user.active) throw new UnauthorizedException('Usuário inativo');

    const accessToken = await this.generateAccessToken(user);
    const refreshToken = await this.generateRefreshToken(user);

    await this.setCurrentRefreshToken(refreshToken, user.id);

    return {
      accessToken,
      refreshToken,
    };
  }

  async generateAccessToken(user: User) {
    return this.jwtService.signAsync(
      { sub: user.id },
      {
        secret: jwtConfig.access.secret,
        expiresIn: jwtConfig.access.expiresIn,
      },
    );
  }

  async generateRefreshToken(user: User) {
    return this.jwtService.signAsync(
      { sub: user.id },
      {
        secret: jwtConfig.refresh.secret,
        expiresIn: jwtConfig.refresh.expiresIn,
      },
    );
  }

  async setCurrentRefreshToken(
    refreshToken: string,
    userId: string,
  ): Promise<void> {
    await this.userService.updateRefresh(
      userId,
      await bcrypt.hash(refreshToken, 10),
    );
  }

  async validateRefreshToken(
    userId: string,
    refreshToken: string,
  ): Promise<User> {
    const user = await this.userService.getByIdAndRefresh(userId);

    if (
      !user?.currentRefreshToken ||
      !(await bcrypt.compare(refreshToken, user.currentRefreshToken))
    ) {
      throw new UnauthorizedException('Token de atualização inválido');
    }

    return user;
  }

  async comparePassword(password: string, hash: string) {
    return bcrypt.compare(password, hash);
  }
}
