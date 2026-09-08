import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { jwtConfig } from '../auth.config';
import { AuthService, type RefreshPayload } from '../auth.service';

export function readRefreshCookie(request: Request): string | undefined {
  return request.headers.cookie
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('cast_refresh='))
    ?.slice('cast_refresh='.length);
}

@Injectable()
export class JwtRefreshGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = readRefreshCookie(request);

    if (!token) {
      throw new UnauthorizedException('Refresh token ausente');
    }

    let payload: RefreshPayload;
    try {
      payload = await this.jwtService.verifyAsync<RefreshPayload>(token, {
        secret: jwtConfig.refresh.secret,
      });
    } catch {
      throw new UnauthorizedException('Refresh token inválido ou expirado');
    }

    const { user, familyId } = await this.authService.consumeRefreshToken(
      payload,
      token,
    );

    Object.assign(request, { user, refreshFamilyId: familyId });

    return true;
  }
}
