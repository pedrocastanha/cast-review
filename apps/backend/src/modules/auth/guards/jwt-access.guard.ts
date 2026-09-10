import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { setCurrentDbActor } from '../../../shared/database/postgres/db-actor';
import { UserService } from '../../users/user.service';
import { jwtConfig } from '../auth.config';
import { IS_PUBLIC_KEY } from '../utils/public.decorator';
import { extractBearerToken } from './extract-bearer-token';

type JwtPayload = { sub: string };

@Injectable()
export class JwtAccessGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly userService: UserService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Access token ausente');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: jwtConfig.access.secret,
      });
    } catch {
      throw new UnauthorizedException('Access token inválido ou expirado');
    }

    // Define o ator ANTES de qualquer leitura: `getById` abaixo já roda sob o
    // escopo do próprio usuário. O `sub` vem do token já verificado acima, que é
    // exatamente a fonte que SEC-16 exige — nunca body, query ou header.
    setCurrentDbActor(payload.sub, 'user');

    const user = await this.userService.getById(payload.sub);

    if (!user) {
      throw new UnauthorizedException('Usuário não encontrado');
    }

    if (!user.active) {
      throw new UnauthorizedException('Usuário inativo');
    }

    Object.assign(request, { user });

    return true;
  }
}
