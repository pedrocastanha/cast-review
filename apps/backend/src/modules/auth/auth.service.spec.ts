import { createHash } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';
import type { RefreshSessionRow } from './refresh-session.repository';

const FUTURE_EXP = Math.floor(Date.now() / 1000) + 3600;

function hashOf(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function activeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user-1',
    email: 'user@cast.test',
    password: 'hashed',
    active: true,
    ...overrides,
  } as never;
}

function sessionRow(
  overrides: Partial<RefreshSessionRow> = {},
): RefreshSessionRow {
  return {
    id: 'session-1',
    userId: 'user-1',
    familyId: 'family-1',
    expiresAt: new Date(Date.now() + 3_600_000),
    consumedAt: null,
    revokedAt: null,
    ...overrides,
  };
}

function buildService(overrides: Record<string, any> = {}) {
  const userService = {
    getByEmail: jest.fn(async () => activeUser()),
    getByUsername: jest.fn(async () => activeUser()),
    getById: jest.fn(async () => activeUser()),
    getForSessionRefresh: jest.fn(async () => activeUser()),
    createUser: jest.fn(async () => activeUser()),
    ...overrides.userService,
  };

  const jwtService = {
    signAsync: jest.fn(async () => 'signed-token'),
    verifyAsync: jest.fn(async () => ({ sub: 'user-1', fid: 'family-1' })),
    decode: jest.fn(() => ({ exp: FUTURE_EXP })),
    ...overrides.jwtService,
  };

  const refreshSessions = {
    create: jest.fn(async () => undefined),
    findByTokenHash: jest.fn(async () => sessionRow()),
    consume: jest.fn(async () => true),
    revokeFamily: jest.fn(async () => 1),
    revokeAllForUser: jest.fn(async () => 1),
    deleteExpired: jest.fn(async () => undefined),
    ...overrides.refreshSessions,
  };

  const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() };

  const service = new AuthService(
    userService as never,
    jwtService as never,
    refreshSessions as never,
    logger as never,
  );

  return { service, userService, jwtService, refreshSessions, logger };
}

describe('AuthService refresh token families', () => {
  beforeEach(() => {
    jest
      .spyOn(AuthService.prototype, 'comparePassword')
      .mockResolvedValue(true as never);
  });

  afterEach(() => jest.restoreAllMocks());

  describe('login', () => {
    it('persists only the hash of the refresh token', async () => {
      const { service, refreshSessions } = buildService();

      const session = await service.login({
        email: 'user@cast.test',
        password: 'pw',
      } as never);

      expect(session.accessToken).toBe('signed-token');
      const stored = refreshSessions.create.mock.calls[0][0];
      expect(stored.tokenHash).toBe(hashOf(session.refreshToken));
      expect(stored.tokenHash).not.toContain(session.refreshToken);
      expect(JSON.stringify(stored)).not.toContain(session.refreshToken);
    });

    it('starts a fresh family per login', async () => {
      const { service, refreshSessions } = buildService();

      await service.login({ email: 'a@cast.test', password: 'pw' } as never);
      await service.login({ email: 'a@cast.test', password: 'pw' } as never);

      const [first] = refreshSessions.create.mock.calls[0];
      const [second] = refreshSessions.create.mock.calls[1];
      expect(first.familyId).not.toBe(second.familyId);
    });

    it('refuses a wrong password without revealing the account', async () => {
      jest
        .spyOn(AuthService.prototype, 'comparePassword')
        .mockResolvedValue(false as never);
      const { service, refreshSessions } = buildService();

      await expect(
        service.login({ email: 'a@cast.test', password: 'wrong' } as never),
      ).rejects.toThrow('E-mail ou senha inválidos');
      expect(refreshSessions.create).not.toHaveBeenCalled();
    });

    it('gives the same message for an unknown account', async () => {
      const { service } = buildService({
        userService: { getByEmail: jest.fn(async () => null) },
      });

      await expect(
        service.login({ email: 'ghost@cast.test', password: 'pw' } as never),
      ).rejects.toThrow('E-mail ou senha inválidos');
    });

    it('refuses an inactive account', async () => {
      const { service } = buildService({
        userService: {
          getByEmail: jest.fn(async () => activeUser({ active: false })),
        },
      });

      await expect(
        service.login({ email: 'a@cast.test', password: 'pw' } as never),
      ).rejects.toThrow('Usuário inativo');
    });

    it('does not log the submitted password', async () => {
      const { service, logger } = buildService();
      await service.login({
        email: 'a@cast.test',
        password: 'super-secret',
      } as never);

      expect(JSON.stringify(logger.log.mock.calls)).not.toContain(
        'super-secret',
      );
    });
  });

  describe('guest login', () => {
    const environment = { ...process.env };

    afterEach(() => {
      process.env = { ...environment };
    });

    it('is refused while the demo access is off', async () => {
      delete process.env.DEMO_LOGIN;
      const { service, userService } = buildService({
        userService: {
          createGuestUser: jest.fn(),
          purgeExpiredGuests: jest.fn(),
        },
      });

      await expect(service.loginAsGuest()).rejects.toThrow(
        /Acesso de teste indispon/,
      );
      expect(userService.createGuestUser).not.toHaveBeenCalled();
    });

    it('issues a real session when the demo access is on', async () => {
      process.env.DEMO_LOGIN = 'true';
      const { service, refreshSessions } = buildService({
        userService: {
          createGuestUser: jest.fn(async () => activeUser({ id: 'guest-1' })),
          purgeExpiredGuests: jest.fn(async () => 0),
        },
      });

      const session = await service.loginAsGuest();

      expect(session.accessToken).toBe('signed-token');
      expect(refreshSessions.create).toHaveBeenCalledTimes(1);
      expect(refreshSessions.create.mock.calls[0][0].userId).toBe('guest-1');
    });

    it('purges expired guests before creating a new one', async () => {
      process.env.DEMO_LOGIN = 'true';
      const purgeExpiredGuests = jest.fn(async () => 3);
      const createGuestUser = jest.fn(async () =>
        activeUser({ id: 'guest-2' }),
      );
      const { service } = buildService({
        userService: { createGuestUser, purgeExpiredGuests },
      });

      await service.loginAsGuest();

      expect(purgeExpiredGuests.mock.invocationCallOrder[0]).toBeLessThan(
        createGuestUser.mock.invocationCallOrder[0],
      );
    });

    it('gives every guest its own session family', async () => {
      process.env.DEMO_LOGIN = 'true';
      const { service, refreshSessions } = buildService({
        userService: {
          createGuestUser: jest.fn(async () => activeUser({ id: 'guest-3' })),
          purgeExpiredGuests: jest.fn(async () => 0),
        },
      });

      await service.loginAsGuest();
      await service.loginAsGuest();

      const [first] = refreshSessions.create.mock.calls[0];
      const [second] = refreshSessions.create.mock.calls[1];
      expect(first.familyId).not.toBe(second.familyId);
    });
  });

  describe('consumeRefreshToken', () => {
    it('rotates a valid token and keeps the family', async () => {
      const { service, refreshSessions } = buildService();

      const result = await service.consumeRefreshToken(
        { sub: 'user-1', fid: 'family-1' },
        'raw-token',
      );

      expect(refreshSessions.findByTokenHash).toHaveBeenCalledWith(
        hashOf('raw-token'),
      );
      expect(refreshSessions.consume).toHaveBeenCalledWith('session-1');
      expect(refreshSessions.revokeFamily).not.toHaveBeenCalled();
      expect(result.familyId).toBe('family-1');
    });

    it('revokes the whole family when an already consumed token is replayed', async () => {
      const { service, refreshSessions } = buildService({
        refreshSessions: {
          findByTokenHash: jest.fn(async () =>
            sessionRow({ consumedAt: new Date() }),
          ),
        },
      });

      await expect(
        service.consumeRefreshToken(
          { sub: 'user-1', fid: 'family-1' },
          'stolen',
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(refreshSessions.revokeFamily).toHaveBeenCalledWith(
        'family-1',
        'reuse_detected',
      );
      expect(refreshSessions.consume).not.toHaveBeenCalled();
    });

    it('revokes the family when a revoked token is replayed', async () => {
      const { service, refreshSessions } = buildService({
        refreshSessions: {
          findByTokenHash: jest.fn(async () =>
            sessionRow({ revokedAt: new Date() }),
          ),
        },
      });

      await expect(
        service.consumeRefreshToken({ sub: 'user-1', fid: 'family-1' }, 'old'),
      ).rejects.toThrow(UnauthorizedException);

      expect(refreshSessions.revokeFamily).toHaveBeenCalledWith(
        'family-1',
        'reuse_detected',
      );
    });

    it('revokes the claimed family when the token is unknown', async () => {
      const { service, refreshSessions } = buildService({
        refreshSessions: { findByTokenHash: jest.fn(async () => null) },
      });

      await expect(
        service.consumeRefreshToken({ sub: 'user-1', fid: 'family-9' }, 'gone'),
      ).rejects.toThrow(UnauthorizedException);

      expect(refreshSessions.revokeFamily).toHaveBeenCalledWith(
        'family-9',
        'reuse_detected',
      );
    });

    it('rejects a token whose subject does not own the session', async () => {
      const { service, refreshSessions } = buildService({
        refreshSessions: {
          findByTokenHash: jest.fn(async () =>
            sessionRow({ userId: 'victim' }),
          ),
        },
      });

      await expect(
        service.consumeRefreshToken(
          { sub: 'attacker', fid: 'family-1' },
          'crafted',
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(refreshSessions.revokeFamily).toHaveBeenCalledWith(
        'family-1',
        'reuse_detected',
      );
      expect(refreshSessions.consume).not.toHaveBeenCalled();
    });

    it('revokes the family when two requests race for the same token', async () => {
      const { service, refreshSessions } = buildService({
        refreshSessions: { consume: jest.fn(async () => false) },
      });

      await expect(
        service.consumeRefreshToken(
          { sub: 'user-1', fid: 'family-1' },
          'raced',
        ),
      ).rejects.toThrow(UnauthorizedException);

      expect(refreshSessions.revokeFamily).toHaveBeenCalledWith(
        'family-1',
        'rotation_conflict',
      );
    });

    it('revokes the family when the user vanished', async () => {
      const { service, refreshSessions } = buildService({
        userService: {
          getById: jest.fn(async () => null),
          getForSessionRefresh: jest.fn(async () => null),
        },
      });

      await expect(
        service.consumeRefreshToken({ sub: 'user-1', fid: 'family-1' }, 'raw'),
      ).rejects.toThrow(UnauthorizedException);

      expect(refreshSessions.revokeFamily).toHaveBeenCalledWith(
        'family-1',
        'logout',
      );
    });

    it('revokes the family when the user became inactive', async () => {
      const { service, refreshSessions } = buildService({
        userService: {
          getById: jest.fn(async () => activeUser({ active: false })),
          getForSessionRefresh: jest.fn(async () =>
            activeUser({ active: false }),
          ),
        },
      });

      await expect(
        service.consumeRefreshToken({ sub: 'user-1', fid: 'family-1' }, 'raw'),
      ).rejects.toThrow('Usuário inativo');

      expect(refreshSessions.revokeFamily).toHaveBeenCalledWith(
        'family-1',
        'logout',
      );
    });

    it('never logs the raw refresh token', async () => {
      const { service, logger } = buildService({
        refreshSessions: {
          findByTokenHash: jest.fn(async () =>
            sessionRow({ consumedAt: new Date() }),
          ),
        },
      });

      await expect(
        service.consumeRefreshToken(
          { sub: 'user-1', fid: 'family-1' },
          'raw-secret-token',
        ),
      ).rejects.toThrow();

      const logged = JSON.stringify([
        ...logger.warn.mock.calls,
        ...logger.log.mock.calls,
        ...logger.error.mock.calls,
      ]);
      expect(logged).not.toContain('raw-secret-token');
    });
  });

  describe('getNewTokens', () => {
    it('issues a new token inside the same family', async () => {
      const { service, refreshSessions } = buildService();

      await service.getNewTokens(activeUser(), 'family-7');

      expect(refreshSessions.create.mock.calls[0][0].familyId).toBe('family-7');
    });

    it('refuses to refresh an inactive user', async () => {
      const { service } = buildService();

      await expect(
        service.getNewTokens(activeUser({ active: false }), 'family-1'),
      ).rejects.toThrow('Usuário inativo');
    });

    it('refuses a refresh token without an expiry claim', async () => {
      const { service } = buildService({
        jwtService: { decode: jest.fn(() => ({})) },
      });

      await expect(
        service.getNewTokens(activeUser(), 'family-1'),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('logout', () => {
    it('revokes only the family of the current device', async () => {
      const { service, refreshSessions } = buildService();

      await service.logout('user-1', 'family-1');

      expect(refreshSessions.revokeFamily).toHaveBeenCalledWith(
        'family-1',
        'logout',
      );
      expect(refreshSessions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('revokes every session when no family is known', async () => {
      const { service, refreshSessions } = buildService();

      await service.logout('user-1');

      expect(refreshSessions.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
        'logout',
      );
    });

    it('revokes the family carried by a valid cookie', async () => {
      const { service, refreshSessions } = buildService();

      await service.logoutFromCookie('cookie-token');

      expect(refreshSessions.revokeFamily).toHaveBeenCalledWith(
        'family-1',
        'logout',
      );
    });

    it('stays silent for a missing cookie', async () => {
      const { service, refreshSessions } = buildService();

      await expect(
        service.logoutFromCookie(undefined),
      ).resolves.toBeUndefined();
      expect(refreshSessions.revokeFamily).not.toHaveBeenCalled();
      expect(refreshSessions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('stays silent for a forged cookie', async () => {
      const { service, refreshSessions } = buildService({
        jwtService: {
          verifyAsync: jest.fn(async () => {
            throw new Error('bad signature');
          }),
        },
      });

      await expect(service.logoutFromCookie('forged')).resolves.toBeUndefined();
      expect(refreshSessions.revokeFamily).not.toHaveBeenCalled();
    });

    it('revokes every session on logoutAll', async () => {
      const { service, refreshSessions } = buildService();

      await service.logoutAll('user-1');

      expect(refreshSessions.revokeAllForUser).toHaveBeenCalledWith(
        'user-1',
        'logout',
      );
    });
  });
});
