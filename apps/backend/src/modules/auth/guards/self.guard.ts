import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '../../users/user.entity';

@Injectable()
export class SelfGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: User }>();

    const user = request.user;

    if (!user) {
      throw new UnauthorizedException('Requisição não autenticada');
    }

    if (request.params.id !== user.id) {
      throw new ForbiddenException(
        'Você só pode acessar os seus próprios dados',
      );
    }

    return true;
  }
}
