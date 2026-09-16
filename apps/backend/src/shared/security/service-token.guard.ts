import { timingSafeEqual } from 'node:crypto';
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { extractBearerToken } from '../../modules/auth/guards/extract-bearer-token';

@Injectable()
export class ServiceTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const token = extractBearerToken(request);

    if (!token) {
      throw new UnauthorizedException('Service token ausente');
    }

    const expected = process.env.AI_SERVICE_TOKEN?.trim();
    if (!expected) {
      throw new UnauthorizedException('AI_SERVICE_TOKEN não configurada');
    }

    const expectedBuffer = Buffer.from(expected);
    const receivedBuffer = Buffer.from(token);

    if (
      expectedBuffer.length !== receivedBuffer.length ||
      !timingSafeEqual(expectedBuffer, receivedBuffer)
    ) {
      throw new UnauthorizedException('Service token inválido');
    }

    return true;
  }
}
