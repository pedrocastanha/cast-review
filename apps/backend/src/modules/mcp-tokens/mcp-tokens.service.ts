import { createHash, randomBytes } from 'node:crypto';
import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { jwtConfig } from '../auth/auth.config';
import { McpToken } from './mcp-token.entity';
import { McpTokenRepository } from './mcp-token.repository';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const SCOPES = ['index:read', 'index:write', 'analyses:read', 'analyses:write'];

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ACTING_JWT_TTL_MS = 2 * 60 * 1000;

@Injectable()
export class McpTokensService {
  constructor(
    private readonly repository: McpTokenRepository,
    private readonly jwtService: JwtService,
  ) {}

  async issue(
    userId: string,
    projectIds: string[],
    expiresAt?: Date,
  ): Promise<{ id: string; token: string; expiresAt: Date }> {
    const rawToken = `mcp_${randomBytes(32).toString('hex')}`;
    const tokenHash = hashToken(rawToken);
    const resolvedExpiresAt = expiresAt ?? new Date(Date.now() + SEVEN_DAYS_MS);

    const saved = await this.repository.save(
      this.repository.create({
        userId,
        tokenHash,
        projectIds,
        expiresAt: resolvedExpiresAt,
      }),
    );

    return { id: saved.id, token: rawToken, expiresAt: saved.expiresAt };
  }

  async list(userId: string): Promise<McpToken[]> {
    return this.repository.find({ where: { userId } });
  }

  async revoke(id: string): Promise<void> {
    const result = await this.repository.update(id, {
      revokedAt: new Date(),
    });

    if (!result.affected) {
      throw new NotFoundException('Token MCP não encontrado');
    }
  }

  async introspect(rawToken: string): Promise<{
    userId: string;
    projectIds: string[];
    scopes: string[];
    actingJwt: string;
    actingJwtExpiresAt: Date;
  }> {
    const tokenHash = hashToken(rawToken);

    const token = await this.repository.withRlsTransaction(
      (manager) =>
        manager.getRepository(McpToken).findOne({ where: { tokenHash } }),
      { actorType: 'service', userId: null },
    );

    if (!token || token.revokedAt || token.expiresAt < new Date()) {
      throw new UnauthorizedException('Token MCP inválido ou expirado');
    }

    const actingJwt = await this.jwtService.signAsync(
      { sub: token.userId },
      { secret: jwtConfig.access.secret, expiresIn: '2m' },
    );
    const actingJwtExpiresAt = new Date(Date.now() + ACTING_JWT_TTL_MS);

    return {
      userId: token.userId,
      projectIds: token.projectIds,
      scopes: SCOPES,
      actingJwt,
      actingJwtExpiresAt,
    };
  }
}
