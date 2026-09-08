import { createHash, randomUUID } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AppLogger } from 'src/shared/logger/logger.service';
import { CreateUserDto } from '../users/dtos/create-user.dto';
import { User } from '../users/user.entity';
import { UserService } from '../users/user.service';
import { jwtConfig } from './auth.config';
import { LoginDto } from './dtos/login.dto';
import { RefreshSessionRepository } from './refresh-session.repository';

export interface RefreshPayload {
  sub: string;
  jti?: string;
  fid?: string;
}

export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export interface ConsumedRefresh {
  user: User;
  familyId: string;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly refreshSessions: RefreshSessionRepository,
    private readonly logger: AppLogger,
  ) {}

  async validateUserByEmail(email: string): Promise<User | null> {
    return this.userService.getByEmail(email);
  }

  async register(dto: CreateUserDto) {
    const user = await this.userService.createUser(dto);
    this.logger.log('Usuário registrado', { userId: user.id });
    return user;
  }

  async login({ email, username, password }: LoginDto): Promise<IssuedSession> {
    if (!email && !username) {
      throw new UnauthorizedException('E-mail ou senha inválidos');
    }

    const identifier = email ?? username;
    const user = email
      ? await this.validateUserByEmail(email)
      : await this.userService.getByUsername(username ?? '');

    if (!user) {
      this.logger.warn('Login falhou: usuário não encontrado', { identifier });
      throw new UnauthorizedException('E-mail ou senha inválidos');
    }

    if (!user.password) {
      throw new UnauthorizedException(
        'Esta conta ainda não possui senha definida.',
      );
    }

    const isPasswordValid = await this.comparePassword(password, user.password);
    if (!isPasswordValid) {
      this.logger.warn('Login falhou: senha inválida', { userId: user.id });
      throw new UnauthorizedException('E-mail ou senha inválidos');
    }

    if (!user.active) {
      this.logger.warn('Login falhou: usuário inativo', { userId: user.id });
      throw new UnauthorizedException('Usuário inativo');
    }

    await this.refreshSessions.deleteExpired(user.id);
    const session = await this.issueSession(user, randomUUID());

    this.logger.log('Login bem-sucedido', { userId: user.id });

    return session;
  }

  async getNewTokens(user: User, familyId: string): Promise<IssuedSession> {
    if (!user.active) throw new UnauthorizedException('Usuário inativo');

    const session = await this.issueSession(user, familyId);
    this.logger.log('Tokens renovados', { userId: user.id });

    return session;
  }

  async consumeRefreshToken(
    payload: RefreshPayload,
    refreshToken: string,
  ): Promise<ConsumedRefresh> {
    const session = await this.refreshSessions.findByTokenHash(
      hashToken(refreshToken),
    );

    if (!session) {
      if (payload.fid) {
        await this.refreshSessions.revokeFamily(payload.fid, 'reuse_detected');
        this.logger.warn('Refresh desconhecido: família revogada', {
          userId: payload.sub,
        });
      }
      throw new UnauthorizedException('Token de atualização inválido');
    }

    if (session.userId !== payload.sub) {
      await this.refreshSessions.revokeFamily(
        session.familyId,
        'reuse_detected',
      );
      throw new UnauthorizedException('Token de atualização inválido');
    }

    if (session.consumedAt || session.revokedAt) {
      await this.refreshSessions.revokeFamily(
        session.familyId,
        'reuse_detected',
      );
      this.logger.warn('Reuse de refresh token detectado', {
        userId: session.userId,
      });
      throw new UnauthorizedException('Token de atualização inválido');
    }

    if (!(await this.refreshSessions.consume(session.id))) {
      await this.refreshSessions.revokeFamily(
        session.familyId,
        'rotation_conflict',
      );
      this.logger.warn('Rotação concorrente de refresh token', {
        userId: session.userId,
      });
      throw new UnauthorizedException('Token de atualização inválido');
    }

    const user = await this.userService.getById(session.userId);

    if (!user) {
      await this.refreshSessions.revokeFamily(session.familyId, 'logout');
      throw new UnauthorizedException('Usuário não encontrado');
    }

    if (!user.active) {
      await this.refreshSessions.revokeFamily(session.familyId, 'logout');
      throw new UnauthorizedException('Usuário inativo');
    }

    return { user, familyId: session.familyId };
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

  async comparePassword(password: string, hash: string) {
    return bcrypt.compare(password, hash);
  }

  async logout(userId: string, familyId?: string): Promise<void> {
    if (familyId) await this.refreshSessions.revokeFamily(familyId, 'logout');
    else await this.refreshSessions.revokeAllForUser(userId, 'logout');
  }

  async logoutAll(userId: string): Promise<void> {
    await this.refreshSessions.revokeAllForUser(userId, 'logout');
  }

  async logoutFromCookie(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;

    let payload: RefreshPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshPayload>(
        refreshToken,
        { secret: jwtConfig.refresh.secret },
      );
    } catch {
      return;
    }

    await this.logout(payload.sub, payload.fid);
  }

  private async issueSession(
    user: User,
    familyId: string,
  ): Promise<IssuedSession> {
    const id = randomUUID();
    const refreshToken = await this.jwtService.signAsync(
      { sub: user.id, jti: id, fid: familyId },
      {
        secret: jwtConfig.refresh.secret,
        expiresIn: jwtConfig.refresh.expiresIn,
      },
    );

    const decoded = this.jwtService.decode(refreshToken) as {
      exp?: number;
    } | null;

    if (!decoded?.exp) {
      throw new UnauthorizedException('Token de atualização inválido');
    }

    const refreshExpiresAt = new Date(decoded.exp * 1000);

    await this.refreshSessions.create({
      id,
      userId: user.id,
      familyId,
      tokenHash: hashToken(refreshToken),
      expiresAt: refreshExpiresAt,
    });

    return {
      accessToken: await this.generateAccessToken(user),
      refreshToken,
      refreshExpiresAt,
    };
  }
}
