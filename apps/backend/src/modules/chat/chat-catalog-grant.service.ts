import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { chatGrantSecret } from '../../shared/security/production-config';
import type { CurrentUserData } from '../auth/utils/current-user-decorator';

interface CatalogGrantClaims {
  userId: string;
  threadId: string;
  expiresAt: number;
}

const GRANT_TTL_MS = 300_000;

@Injectable()
export class ChatCatalogGrantService {
  issue(user: CurrentUserData, threadId: string): string {
    const payload = Buffer.from(
      JSON.stringify({
        userId: user.id,
        threadId,
        expiresAt: Date.now() + GRANT_TTL_MS,
      } satisfies CatalogGrantClaims),
    ).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  verify(grant: string): CatalogGrantClaims {
    const parts = grant.split('.');
    const [payload, signature] = parts;
    if (
      parts.length !== 2 ||
      !payload ||
      !signature ||
      !this.matches(payload, signature)
    ) {
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
      !claims ||
      typeof claims !== 'object' ||
      Array.isArray(claims) ||
      typeof claims.userId !== 'string' ||
      !claims.userId ||
      typeof claims.threadId !== 'string' ||
      !claims.threadId ||
      typeof claims.expiresAt !== 'number' ||
      !Number.isFinite(claims.expiresAt) ||
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
    return createHmac('sha256', chatGrantSecret())
      .update(payload)
      .digest('base64url');
  }
}
