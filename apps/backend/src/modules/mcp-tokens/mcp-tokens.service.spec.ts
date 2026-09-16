import { createHash } from 'node:crypto';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { McpToken } from './mcp-token.entity';
import { McpTokensService } from './mcp-tokens.service';

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function fakeToken(overrides: Partial<McpToken> = {}): McpToken {
  return {
    id: 'token-1',
    userId: 'user-1',
    tokenHash: sha256('mcp_raw'),
    projectIds: ['project-1'],
    expiresAt: new Date(Date.now() + 60_000),
    revokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as McpToken;
}

function buildService() {
  const repository = {
    create: jest.fn((entityLike) => entityLike),
    save: jest.fn(),
    find: jest.fn(),
    update: jest.fn(),
    withRlsTransaction: jest.fn(),
  };
  const jwtService = {
    signAsync: jest.fn(),
  };
  const service = new McpTokensService(repository as any, jwtService as any);
  return { service, repository, jwtService };
}

describe('McpTokensService#issue', () => {
  it('generates an opaque token, persists its sha256 hash, and defaults expiresAt to ~7 days', async () => {
    const { service, repository } = buildService();
    const saved = fakeToken({ id: 'token-2' });
    repository.save.mockResolvedValue(saved);

    const result = await service.issue('user-1', ['project-1']);

    expect(result.token).toMatch(/^mcp_[0-9a-f]{64}$/);

    const savedArg = repository.save.mock.calls[0][0];
    expect(savedArg.userId).toBe('user-1');
    expect(savedArg.projectIds).toEqual(['project-1']);
    expect(savedArg.tokenHash).toBe(sha256(result.token));

    const expectedExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
    expect(savedArg.expiresAt.getTime()).toBeGreaterThan(expectedExpiry - 5000);
    expect(savedArg.expiresAt.getTime()).toBeLessThan(expectedExpiry + 5000);

    expect(result.id).toBe(saved.id);
    expect(result.expiresAt).toBe(saved.expiresAt);
  });

  it('uses the provided expiresAt when given', async () => {
    const { service, repository } = buildService();
    const explicitExpiry = new Date(Date.now() + 1000 * 60 * 60);
    repository.save.mockResolvedValue(fakeToken({ expiresAt: explicitExpiry }));

    await service.issue('user-1', ['project-1'], explicitExpiry);

    const savedArg = repository.save.mock.calls[0][0];
    expect(savedArg.expiresAt).toBe(explicitExpiry);
  });
});

describe('McpTokensService#list', () => {
  it('delegates to repository.find scoped by userId', async () => {
    const { service, repository } = buildService();
    const tokens = [fakeToken()];
    repository.find.mockResolvedValue(tokens);

    const result = await service.list('user-1');

    expect(repository.find).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
    });
    expect(result).toBe(tokens);
  });
});

describe('McpTokensService#revoke', () => {
  it('sets revokedAt on the happy path', async () => {
    const { service, repository } = buildService();
    repository.update.mockResolvedValue({ affected: 1 });

    await service.revoke('token-1');

    expect(repository.update).toHaveBeenCalledWith(
      'token-1',
      expect.objectContaining({ revokedAt: expect.any(Date) }),
    );
  });

  it('throws NotFoundException when affected is 0', async () => {
    const { service, repository } = buildService();
    repository.update.mockResolvedValue({ affected: 0 });

    await expect(service.revoke('token-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('McpTokensService#introspect', () => {
  it('returns actingJwt, fixed scopes, and projectIds for a valid token', async () => {
    const { service, repository, jwtService } = buildService();
    const rawToken = 'mcp_raw';
    const token = fakeToken({ tokenHash: sha256(rawToken) });
    repository.withRlsTransaction.mockResolvedValue(token);
    jwtService.signAsync.mockResolvedValue('signed.jwt.token');

    const result = await service.introspect(rawToken);

    expect(jwtService.signAsync).toHaveBeenCalledWith(
      { sub: token.userId },
      expect.objectContaining({ expiresIn: '2m' }),
    );
    expect(result.actingJwt).toBe('signed.jwt.token');
    expect(result.userId).toBe(token.userId);
    expect(result.projectIds).toEqual(token.projectIds);
    expect(result.scopes).toEqual([
      'index:read',
      'index:write',
      'analyses:read',
      'analyses:write',
    ]);
    expect(result.actingJwtExpiresAt).toBeInstanceOf(Date);
  });

  it('calls the repository lookup with the service actor override', async () => {
    const { service, repository, jwtService } = buildService();
    const rawToken = 'mcp_raw';
    const token = fakeToken({ tokenHash: sha256(rawToken) });
    repository.withRlsTransaction.mockResolvedValue(token);
    jwtService.signAsync.mockResolvedValue('signed.jwt.token');

    await service.introspect(rawToken);

    expect(repository.withRlsTransaction).toHaveBeenCalledWith(
      expect.any(Function),
      { actorType: 'service', userId: null },
    );
  });

  it('throws UnauthorizedException when the token is not found', async () => {
    const { service, repository } = buildService();
    repository.withRlsTransaction.mockResolvedValue(null);

    await expect(service.introspect('mcp_missing')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when the token is revoked', async () => {
    const { service, repository } = buildService();
    repository.withRlsTransaction.mockResolvedValue(
      fakeToken({ revokedAt: new Date() }),
    );

    await expect(service.introspect('mcp_revoked')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when the token is expired', async () => {
    const { service, repository } = buildService();
    repository.withRlsTransaction.mockResolvedValue(
      fakeToken({ expiresAt: new Date(Date.now() - 1000) }),
    );

    await expect(service.introspect('mcp_expired')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
