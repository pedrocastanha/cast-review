import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';

interface CatalogGrantClaims {
  user: CurrentUserData;
  threadId: string;
  expiresAt: number;
}

const GRANT_TTL_MS = 300_000;

@Injectable()
export class ChatCatalogGrantService {
  issue(user: CurrentUserData, threadId: string): string {
    const payload = Buffer.from(
      JSON.stringify({
        user,
        threadId,
        expiresAt: Date.now() + GRANT_TTL_MS,
      } satisfies CatalogGrantClaims),
    ).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  verify(grant: string): CatalogGrantClaims {
    const [payload, signature] = grant.split('.');
    if (!payload || !signature || !this.matches(payload, signature)) {
      throw new UnauthorizedException('Grant de catálogo inválido');
    }

    let claims: CatalogGrantClaims;
    try {
      claims = JSON.parse(
        Buffer.from(payload, 'base64url').toString('utf8'),
      ) as CatalogGrantClaims;
    } catch {
      throw new UnauthorizedException('Grant de catálogo inválido');
    }

    if (
      !claims.user?.id ||
      !claims.user.email ||
      !claims.threadId ||
      claims.expiresAt < Date.now()
    ) {
      throw new UnauthorizedException('Grant de catálogo expirado');
    }

    return claims;
  }

  private matches(payload: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(payload));
    const received = Buffer.from(signature);
    return (
      expected.length === received.length && timingSafeEqual(expected, received)
    );
  }

  private sign(payload: string): string {
    const secret = process.env.SECRET_ENCRYPTION_KEY?.trim();
    if (!secret) {
      throw new Error('SECRET_ENCRYPTION_KEY não configurada');
    }
    return createHmac('sha256', secret).update(payload).digest('base64url');
  }
}
